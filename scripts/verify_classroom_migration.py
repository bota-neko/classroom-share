#!/usr/bin/env python3
"""Read-only comparison of Classroom Share before and after consolidation.

Run after the Auth and data migrations with the private UUID mapping file.
This checks every source row, password hash, and Storage object. It never writes
to either project. Run while classroom-share is not accepting new writes so
both sides describe the same snapshot.
"""

# TODO: Verify login, RLS, and Realtime flows with test accounts after cutover.

import argparse
import hashlib
import json
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from migrate_classroom_data import (
    FILE_COLUMNS,
    FILE_FOLDERS,
    SOURCE_DIR,
    SOURCE_REF,
    TABLES,
    TARGET_DIR,
    TARGET_REF,
    USER_COLUMNS,
    linked_ref,
    storage_path,
)


def query(workdir, sql):
    for attempt in range(3):
        try:
            result = subprocess.run(
                ['supabase', 'db', 'query', '--linked', sql],
                cwd=workdir, capture_output=True, text=True, check=False,
                timeout=30,
            )
        except subprocess.TimeoutExpired:
            if attempt == 2:
                raise RuntimeError(
                    f'Query timed out 3 times in {workdir.name}; details suppressed'
                ) from None
            continue
        if result.returncode:
            raise RuntimeError(f'Query failed in {workdir.name}; details suppressed')
        start = result.stdout.find('{')
        if start < 0:
            raise RuntimeError(f'No JSON query result from {workdir.name}')
        return json.loads(result.stdout[start:])['rows']


def rows(workdir, schema, table):
    found = []
    offset = 0
    while True:
        page = query(
            workdir,
            f'SELECT row_to_json(t) AS row FROM {schema}.{table} t '
            f'ORDER BY id LIMIT 100 OFFSET {offset}',
        )
        found.extend(item['row'] for item in page)
        if len(page) < 100:
            return found
        offset += len(page)


def expected_file_url(table, row, old_url):
    old_path = storage_path(old_url)
    if old_path is None:
        return old_url, None
    if not row.get('class_id') or not row.get('user_id'):
        raise ValueError(f'{table} has a file row without class/user ID')
    new_path = '/'.join((
        FILE_FOLDERS[table], row['class_id'], row['user_id'],
        old_path.rsplit('/', 1)[-1],
    ))
    url = (
        f'https://{TARGET_REF}.supabase.co/storage/v1/object/public/'
        f'classroom-uploads/{urllib.parse.quote(new_path, safe="/")}'
    )
    return url, new_path


def normalized_source_row(table, source, mapping):
    expected = dict(source)
    for column in USER_COLUMNS[table]:
        value = expected.get(column)
        if value:
            expected[column] = mapping.get(value, value)
    file_column = FILE_COLUMNS.get(table)
    path = None
    if file_column and expected.get(file_column):
        expected[file_column], path = expected_file_url(
            table, expected, expected[file_column],
        )
    return expected, path


def compare_auth(mapping, problems):
    source = query(SOURCE_DIR, 'SELECT id,email,encrypted_password FROM auth.users')
    target = query(TARGET_DIR, 'SELECT id,email,encrypted_password FROM auth.users')
    target_by_id = {item['id']: item for item in target}
    for user in source:
        expected_id = mapping.get(user['id'], user['id'])
        actual = target_by_id.get(expected_id)
        if not actual:
            problems.append('Auth: source user missing in target')
        elif actual['email'].casefold() != user['email'].casefold():
            problems.append('Auth: mapped email differs')
        elif actual['encrypted_password'] != user['encrypted_password']:
            problems.append('Auth: password hash differs')
    print(f'Auth: checked {len(source)} source users')


def file_digest(ref, bucket, path):
    url = (
        f'https://{ref}.supabase.co/storage/v1/object/public/'
        f'{bucket}/{urllib.parse.quote(path, safe="/")}'
    )
    digest = hashlib.sha256()
    with urllib.request.urlopen(url, timeout=60) as response:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.digest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mapping', required=True, type=Path,
                        help='Private UUID mapping written by migrate_classroom_auth.py')
    args = parser.parse_args()
    if linked_ref(SOURCE_DIR) != SOURCE_REF or linked_ref(TARGET_DIR) != TARGET_REF:
        parser.error('Linked source/target project does not match the expected refs')
    mapping = json.loads(args.mapping.read_text())
    if not isinstance(mapping, dict):
        parser.error('Mapping must be a JSON object')

    problems = []
    compare_auth(mapping, problems)
    referenced_paths = set()
    file_paths = {}
    for table in TABLES:
        source_rows = rows(SOURCE_DIR, 'public', table)
        target_rows = rows(TARGET_DIR, 'classroom_share', table)
        target_by_id = {row['id']: row for row in target_rows}
        if len(source_rows) != len(target_rows):
            problems.append(f'{table}: row count differs')
        for row in source_rows:
            expected, path = normalized_source_row(table, row, mapping)
            if path:
                referenced_paths.add(path)
                file_paths[storage_path(row[FILE_COLUMNS[table]])] = path
            if target_by_id.get(expected['id']) != expected:
                problems.append(f'{table}: row differs or is missing')
        print(f'{table}: checked {len(source_rows)} source rows')

    source_objects = {
        item['name'] for item in query(
            SOURCE_DIR, "SELECT name FROM storage.objects WHERE bucket_id='uploads'",
        )
    }
    target_objects = {
        item['name'] for item in query(
            TARGET_DIR,
            "SELECT name FROM storage.objects WHERE bucket_id='classroom-uploads'",
        )
    }
    referenced_old = set()
    for table in FILE_COLUMNS:
        for row in rows(SOURCE_DIR, 'public', table):
            value = row.get(FILE_COLUMNS[table])
            if value and storage_path(value):
                referenced_old.add(storage_path(value))
    expected_objects = referenced_paths | {
        'legacy/' + path for path in source_objects - referenced_old
    }
    file_paths.update({
        path: 'legacy/' + path for path in source_objects - referenced_old
    })
    if expected_objects != target_objects:
        problems.append('Storage: object path set differs')
    for old_path, new_path in sorted(file_paths.items()):
        if new_path not in target_objects:
            continue
        if file_digest(SOURCE_REF, 'uploads', old_path) != file_digest(
            TARGET_REF, 'classroom-uploads', new_path,
        ):
            problems.append('Storage: file content differs')
    print(f'Storage: checked {len(source_objects)} source objects')

    if problems:
        for message in sorted(set(problems)):
            print('FAIL:', message, file=sys.stderr)
        return 1
    print('PASS: source Auth, table rows, and Storage object paths match target')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
