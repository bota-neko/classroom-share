#!/usr/bin/env python3
"""Copy Classroom Share rows and referenced files between linked Supabase projects.

The script is read-only unless --apply, --mapping and --confirm-target-ref are all
provided. Auth users must be migrated first. Mapping JSON maps old UUIDs to new
UUIDs; use {} when all UUIDs are preserved. This script never imports auth.users.
"""

import argparse
import hashlib
import json
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

SOURCE_DIR = Path('/tmp/classroom-migrate-source')
TARGET_DIR = Path('/tmp/classroom-migrate-target')
SOURCE_REF = 'lxruzejczxwksgljxmpw'
TARGET_REF = 'fktqwohvwxlkscwyvlqh'
TABLES = [
    'profiles', 'classes', 'memberships', 'messages', 'message_likes',
    'board_posts', 'board_replies', 'works', 'shared_files', 'notifications',
]
USER_COLUMNS = {
    'profiles': ('id',), 'classes': ('created_by',),
    'memberships': ('user_id',), 'messages': ('user_id', 'receiver_id', 'recipient_id'),
    'message_likes': ('user_id',), 'board_posts': ('user_id',),
    'board_replies': ('user_id',), 'works': ('user_id',),
    'shared_files': ('user_id',), 'notifications': ('user_id',),
}
FILE_COLUMNS = {'messages': 'image_url', 'works': 'image_url', 'shared_files': 'file_url'}
FILE_FOLDERS = {'messages': 'messages', 'works': 'works', 'shared_files': 'files'}


def linked_ref(workdir):
    return (workdir / 'supabase/.temp/project-ref').read_text().strip()


def query(workdir, sql):
    result = subprocess.run(
        ['supabase', 'db', 'query', '--linked', sql], cwd=workdir,
        capture_output=True, text=True, check=False,
    )
    if result.returncode:
        # CLI errors can echo SQL containing personal data; keep them out of logs.
        raise RuntimeError(f'Supabase query failed in {workdir.name}; SQL output suppressed')
    start = result.stdout.find('{')
    if start < 0:
        raise RuntimeError('Supabase query returned no JSON')
    return json.loads(result.stdout[start:])['rows']


def fetch_table(table):
    rows = []
    offset = 0
    while True:
        page = query(SOURCE_DIR, f'SELECT row_to_json(t) AS row FROM public.{table} t ORDER BY id LIMIT 100 OFFSET {offset}')
        rows.extend(item['row'] for item in page)
        if len(page) < 100:
            return rows
        offset += len(page)


def service_key(ref):
    result = subprocess.run(
        ['supabase', 'projects', 'api-keys', '--project-ref', ref, '--reveal', '-o', 'json'],
        capture_output=True, text=True, check=True,
    )
    keys = json.loads(result.stdout)
    return next(item['api_key'] for item in keys if item['name'] == 'service_role')


def storage_path(url):
    marker = '/storage/v1/object/public/uploads/'
    parsed = urllib.parse.urlparse(url)
    if parsed.hostname != f'{SOURCE_REF}.supabase.co' or marker not in parsed.path:
        return None
    return urllib.parse.unquote(parsed.path.split(marker, 1)[1])


def transfer_file(old_url, table, row, target_key):
    old_path = storage_path(old_url)
    if old_path is None:
        return old_url
    if not row.get('class_id') or not row.get('user_id'):
        raise RuntimeError(f'{table} row {row["id"]} has a file without class/user ID')
    new_path = '/'.join((FILE_FOLDERS[table], row['class_id'], row['user_id'], old_path.rsplit('/', 1)[-1]))
    upload_path(old_path, new_path, target_key)
    return f'https://{TARGET_REF}.supabase.co/storage/v1/object/public/classroom-uploads/{urllib.parse.quote(new_path, safe="/")}'


def upload_path(old_path, new_path, target_key):
    source_url = f'https://{SOURCE_REF}.supabase.co/storage/v1/object/public/uploads/{urllib.parse.quote(old_path, safe="/")}'
    with urllib.request.urlopen(source_url, timeout=60) as response:
        data = response.read()
        content_type = response.headers.get('Content-Type', 'application/octet-stream')
    expected_hash = hashlib.sha256(data).digest()
    public_target_url = f'https://{TARGET_REF}.supabase.co/storage/v1/object/public/classroom-uploads/{urllib.parse.quote(new_path, safe="/")}'

    def target_data():
        try:
            with urllib.request.urlopen(public_target_url, timeout=60) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            # Storage's public-object endpoint reports a missing object as
            # HTTP 400 with statusCode 404 and error "not_found".
            if error.code == 400:
                try:
                    detail = json.loads(error.read())
                except (ValueError, UnicodeDecodeError):
                    raise error
                if str(detail.get('statusCode')) == '404' and detail.get('error') == 'not_found':
                    return None
            raise

    existing = target_data()
    if existing is not None:
        if len(existing) != len(data) or hashlib.sha256(existing).digest() != expected_hash:
            raise RuntimeError(f'Target path collision with different content: {new_path}')
        return
    target_url = f'https://{TARGET_REF}.supabase.co/storage/v1/object/classroom-uploads/{urllib.parse.quote(new_path, safe="/")}'
    request = urllib.request.Request(
        target_url, data=data, method='POST', headers={
            'Authorization': f'Bearer {target_key}', 'apikey': target_key,
            'Content-Type': content_type, 'x-upsert': 'false',
        },
    )
    try:
        urllib.request.urlopen(request, timeout=120).close()
    except urllib.error.HTTPError as error:
        if error.code != 409:
            raise RuntimeError(f'Storage upload failed for {old_path}: HTTP {error.code}') from error
    uploaded = target_data()
    if uploaded is None or len(uploaded) != len(data) or hashlib.sha256(uploaded).digest() != expected_hash:
        raise RuntimeError(f'Target file verification failed: {new_path}')



def sql_literal(value):
    return "'" + json.dumps(value, ensure_ascii=False).replace("'", "''") + "'::json"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mapping', type=Path, help='JSON mapping old auth UUID to target auth UUID')
    parser.add_argument('--apply', action='store_true', help='Write to target; otherwise read-only dry run')
    parser.add_argument('--confirm-target-ref', help='Must equal the linked target ref when applying')
    args = parser.parse_args()
    if linked_ref(SOURCE_DIR) != SOURCE_REF or linked_ref(TARGET_DIR) != TARGET_REF:
        parser.error('Linked source/target ref does not match the expected projects')
    if args.apply and (not args.mapping or args.confirm_target_ref != TARGET_REF):
        parser.error('--apply requires --mapping and --confirm-target-ref with the target project ref')
    mapping = json.loads(args.mapping.read_text()) if args.mapping else {}
    if not isinstance(mapping, dict):
        parser.error('Mapping must be a JSON object of old UUID to target UUID')
    for old_id, new_id in mapping.items():
        try:
            uuid.UUID(old_id)
            uuid.UUID(new_id)
        except (ValueError, TypeError) as error:
            parser.error(f'Mapping contains a non-UUID value: {error}')

    all_rows = {table: fetch_table(table) for table in TABLES}
    source_objects = query(SOURCE_DIR, "SELECT name FROM storage.objects WHERE bucket_id='uploads' ORDER BY name")
    referenced_users = set()
    file_count = 0
    for table, rows in all_rows.items():
        for row in rows:
            for column in USER_COLUMNS[table]:
                if row.get(column):
                    row[column] = mapping.get(row[column], row[column])
                    referenced_users.add(row[column])
            file_column = FILE_COLUMNS.get(table)
            if file_column and row.get(file_column) and storage_path(row[file_column]):
                file_count += 1
        print(f'{table}: {len(rows)} rows')
    print(f'Auth UUIDs required in target: {len(referenced_users)}; referenced files: {file_count}; total stored objects: {len(source_objects)}')
    if not args.apply:
        print('DRY RUN: no target data or files were changed')
        return

    # Fail before any write if Auth migration or schema setup is incomplete.
    missing = []
    for user_id in sorted(referenced_users):
        found = query(TARGET_DIR, f"SELECT id FROM auth.users WHERE id = '{user_id}'::uuid")
        if not found:
            missing.append(user_id)
    if missing:
        raise RuntimeError(f'{len(missing)} mapped Auth UUIDs are absent in target; no writes made: {missing[:5]}')
    if not query(TARGET_DIR, "SELECT schema_name FROM information_schema.schemata WHERE schema_name='classroom_share'"):
        raise RuntimeError('classroom_share schema is absent in target; no writes made')
    if not query(TARGET_DIR, "SELECT id FROM storage.buckets WHERE id='classroom-uploads'"):
        raise RuntimeError('classroom-uploads bucket is absent in target; no writes made')

    # A source deletion needs a deliberate decision; never delete target rows here.
    for table, rows in all_rows.items():
        source_ids = {row['id'] for row in rows}
        target_ids = {row['id'] for row in query(TARGET_DIR, f'SELECT id FROM classroom_share.{table}')}
        extra_ids = target_ids - source_ids
        if extra_ids:
            raise RuntimeError(f'{table}: {len(extra_ids)} target-only rows detected; '
                               'no writes made. Review source deletions manually.')

    target_key = service_key(TARGET_REF) if source_objects else None
    transferred = {}
    for table, rows in all_rows.items():
        for row in rows:
            file_column = FILE_COLUMNS.get(table)
            if file_column and row.get(file_column):
                old_url = row[file_column]
                if old_url not in transferred:
                    transferred[old_url] = transfer_file(old_url, table, row, target_key)
                row[file_column] = transferred[old_url]
        if table == 'shared_files':
            referenced_paths = {storage_path(url) for url in transferred}
            for item in source_objects:
                old_path = item['name']
                if old_path not in referenced_paths:
                    upload_path(old_path, 'legacy/' + old_path, target_key)
            print(f'Storage: {len(referenced_paths)} referenced files and '
                  f'{len(source_objects) - len(referenced_paths)} unreferenced files copied')
        for start in range(0, len(rows), 50):
            batch = rows[start:start + 50]
            payload = sql_literal(batch)
            columns = [column for column in batch[0] if column != 'id']
            assignments = ', '.join(f'{column} = EXCLUDED.{column}' for column in columns)
            sql = (f"INSERT INTO classroom_share.{table} "
                   f"SELECT * FROM json_populate_recordset(NULL::classroom_share.{table}, {payload}) "
                   "WHERE true "
                   f"ON CONFLICT (id) DO UPDATE SET {assignments}")
            query(TARGET_DIR, sql)
        target_count = query(TARGET_DIR, f'SELECT count(*) AS n FROM classroom_share.{table}')[0]['n']
        if int(target_count) != len(rows):
            raise RuntimeError(f'{table}: source {len(rows)} rows but target {target_count}; inspect partial import')
        print(f'{table}: verified {target_count} rows in target')
    print('Data import complete. Verify app behavior before changing deployment configuration.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
