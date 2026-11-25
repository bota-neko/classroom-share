#!/usr/bin/env python3
"""Prepare or migrate Classroom Share Auth users into bota-neko's Project.

Default mode only reads both projects and reports counts. In apply mode, existing
target users with the same email keep their target UUID and receive only the
source encrypted_password. Other source users retain their UUID and password
hash. Only identities of newly inserted users are copied. No public tables are
changed. Run before migrate_classroom_data.py.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

SOURCE_DIR = Path('/tmp/classroom-migrate-source')
TARGET_DIR = Path('/tmp/classroom-migrate-target')
SOURCE_REF = 'lxruzejczxwksgljxmpw'
TARGET_REF = 'fktqwohvwxlkscwyvlqh'
TOKEN_COLUMNS = (
    'confirmation_token', 'recovery_token', 'email_change_token_new',
    'email_change_token_current', 'phone_change_token', 'reauthentication_token',
)


def query(workdir, sql=None, file=None):
    args = ['supabase', 'db', 'query', '--linked']
    args += ['--file', str(file)] if file else [sql]
    result = subprocess.run(args, cwd=workdir, capture_output=True, text=True)
    if result.returncode:
        # stderr can contain the SQL body and password hashes. Never echo it.
        raise RuntimeError(f'Supabase query failed in {workdir.name}; output suppressed to protect credentials')
    start = result.stdout.find('{')
    if start < 0:
        raise RuntimeError('Supabase query returned no JSON')
    return json.loads(result.stdout[start:])['rows']


def linked_ref(workdir):
    return (workdir / 'supabase/.temp/project-ref').read_text().strip()


def literal(value):
    if value is None:
        return 'NULL'
    return "'" + str(value).replace("'", "''") + "'"


def json_literal(value):
    return literal(json.dumps(value, ensure_ascii=False)) + '::json'


def insert_records(table, records):
    """Preserve auth rows while letting Postgres calculate generated columns."""
    if table not in ('users', 'identities'):
        raise ValueError('Unsupported Auth table')
    columns = query(TARGET_DIR,
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema='auth' AND table_name=" + literal(table)
                    + " AND is_generated='NEVER' ORDER BY ordinal_position")
    names = [item['column_name'] for item in columns]
    if not names:
        raise RuntimeError('Auth table columns could not be read')
    quoted = ', '.join('"' + name.replace('"', '""') + '"' for name in names)
    return (f'INSERT INTO auth.{table} ({quoted}) SELECT {quoted} '
            f'FROM json_populate_recordset(NULL::auth.{table}, {json_literal(records)});')


def fetch_source():
    users = [item['row'] for item in query(
        SOURCE_DIR, 'SELECT row_to_json(u) AS row FROM auth.users u ORDER BY id'
    )]
    identities = [item['row'] for item in query(
        SOURCE_DIR, 'SELECT row_to_json(i) AS row FROM auth.identities i ORDER BY id'
    )]
    return users, identities


def fetch_target_matches(users, identities):
    emails = [u['email'] for u in users if u.get('email')]
    user_ids = [u['id'] for u in users]
    email_clause = ','.join(literal(e.lower()) for e in emails) or "''"
    id_clause = ','.join(literal(i) + '::uuid' for i in user_ids) or 'null::uuid'
    target_users = query(TARGET_DIR, f'SELECT id,email,encrypted_password FROM auth.users WHERE lower(email) IN ({email_clause}) OR id IN ({id_clause})')
    identity_ids = [i['id'] for i in identities]
    identity_clause = ','.join(literal(i) + '::uuid' for i in identity_ids) or 'null::uuid'
    provider_clause = ','.join('(' + literal(i['provider_id']) + ',' + literal(i['provider']) + ')'
                               for i in identities) or "('', '')"
    target_identities = query(TARGET_DIR, 'SELECT id,provider_id,provider FROM auth.identities '
                              f'WHERE id IN ({identity_clause}) OR (provider_id,provider) IN ({provider_clause})')
    return target_users, target_identities


def save_mapping(path, mapping):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, 'w') as output:
            json.dump(mapping, output, indent=2)
            output.write('\n')
    except Exception:
        Path(path).unlink(missing_ok=True)
        raise


def verify_target(users, identities, mapping):
    """Read back required Auth records without logging password hashes."""
    target_ids = [mapping.get(u['id'], u['id']) for u in users]
    id_clause = ','.join(literal(i) + '::uuid' for i in target_ids)
    stored_users = query(TARGET_DIR, 'SELECT id,email,encrypted_password FROM auth.users '
                         f'WHERE id IN ({id_clause})')
    by_id = {u['id']: u for u in stored_users}
    for source in users:
        target = by_id.get(mapping.get(source['id'], source['id']))
        if not target or target['email'].lower() != source['email'].lower() \
                or target['encrypted_password'] != source['encrypted_password']:
            raise RuntimeError('Post-apply Auth user verification failed')
    new_identity_ids = [i['id'] for i in identities if i['user_id'] not in mapping]
    if new_identity_ids:
        identity_clause = ','.join(literal(i) + '::uuid' for i in new_identity_ids)
        stored_identities = query(TARGET_DIR, 'SELECT id,user_id,provider_id,provider '
                                  f'FROM auth.identities WHERE id IN ({identity_clause})')
        by_id = {i['id']: i for i in stored_identities}
        for source in identities:
            if source['user_id'] in mapping:
                continue
            target = by_id.get(source['id'])
            if not target or any(target[key] != source[key]
                                 for key in ('user_id', 'provider_id', 'provider')):
                raise RuntimeError('Post-apply Auth identity verification failed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--confirm-target-ref')
    parser.add_argument('--expected-overlap', type=int, default=2)
    parser.add_argument('--mapping-output', type=Path,
                        help='Create a private JSON mapping for migrate_classroom_data.py')
    args = parser.parse_args()
    if linked_ref(SOURCE_DIR) != SOURCE_REF or linked_ref(TARGET_DIR) != TARGET_REF:
        parser.error('Linked projects do not match the expected source and target')
    if args.apply and (args.confirm_target_ref != TARGET_REF or not args.mapping_output):
        parser.error('--apply requires --confirm-target-ref and --mapping-output')
    if args.mapping_output and args.mapping_output.exists():
        parser.error('Mapping output already exists; refusing to overwrite')

    users, identities = fetch_source()
    target_users, target_identities = fetch_target_matches(users, identities)
    target_by_email = {u['email'].lower(): u for u in target_users if u.get('email')}
    target_by_id = {u['id']: u for u in target_users}
    mapping = {}
    new_users = []
    overlaps = []
    for user in users:
        email = user.get('email')
        if not email:
            raise RuntimeError('A source Auth user has no email; manual review required')
        existing = target_by_email.get(email.lower())
        if existing:
            if not user.get('encrypted_password'):
                raise RuntimeError('An overlapping source user has no password hash')
            overlaps.append((user, existing))
            mapping[user['id']] = existing['id']
        else:
            if user['id'] in target_by_id:
                raise RuntimeError('Source UUID already belongs to a different target email')
            cleaned = dict(user)
            for column in TOKEN_COLUMNS:
                if cleaned.get(column) is not None:
                    cleaned[column] = ''
            new_users.append(cleaned)
    if len(overlaps) != args.expected_overlap:
        raise RuntimeError(f'Expected {args.expected_overlap} overlapping emails, found {len(overlaps)}')

    new_user_ids = {u['id'] for u in new_users}
    new_identities = [i for i in identities if i['user_id'] in new_user_ids]
    existing_identity_ids = {i['id'] for i in target_identities}
    existing_providers = {(i['provider_id'], i['provider']) for i in target_identities}
    if any(i['id'] in existing_identity_ids or (i['provider_id'], i['provider']) in existing_providers
           for i in new_identities):
        raise RuntimeError('An Auth identity UUID or provider key already exists in target')
    print(f'Source Auth users: {len(users)}; target email overlaps: {len(overlaps)}; '
          f'new users: {len(new_users)}; new identities: {len(new_identities)}')
    print('Target public tables will remain untouched')
    if not args.apply:
        if args.mapping_output:
            save_mapping(args.mapping_output, mapping)
            print(f'Dry-run mapping saved: {args.mapping_output}')
        print('DRY RUN: no target Auth records changed')
        return

    statements = ['BEGIN;']
    if new_users:
        statements.append(insert_records('users', new_users))
    if new_identities:
        statements.append(insert_records('identities', new_identities))
    for source, target in overlaps:
        statements.append('DO $classroom_auth$ BEGIN UPDATE auth.users SET encrypted_password = '
                          + literal(source['encrypted_password'])
                          + ' WHERE id = ' + literal(target['id']) + '::uuid AND lower(email) = '
                          + literal(source['email'].lower())
                          + ' AND encrypted_password IS NOT DISTINCT FROM '
                          + literal(target['encrypted_password'])
                          + "; IF NOT FOUND THEN RAISE EXCEPTION 'Overlap Auth update failed'; END IF; END $classroom_auth$;")
    statements.append('COMMIT;')
    descriptor, temp_name = tempfile.mkstemp(prefix='classroom-auth-', suffix='.sql')
    os.fchmod(descriptor, 0o600)
    try:
        with os.fdopen(descriptor, 'w') as temp_file:
            temp_file.write('\n'.join(statements) + '\n')
        query(TARGET_DIR, file=Path(temp_name))
    finally:
        Path(temp_name).unlink(missing_ok=True)
    verify_target(users, identities, mapping)
    save_mapping(args.mapping_output, mapping)
    print(f'Auth migration applied and verified; mapping saved: {args.mapping_output}')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
