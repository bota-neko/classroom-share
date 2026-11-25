#!/usr/bin/env python3
"""Temporarily freeze Classroom Share source writes while preserving reads.

Default is a transaction rolled back in the source database. --apply with the
source project ref persists the freeze. --unfreeze restores exactly the grants
saved at freeze time. Supabase Auth signup is managed separately.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

SOURCE_DIR = Path('/tmp/classroom-migrate-source')
SOURCE_REF = 'lxruzejczxwksgljxmpw'
DEFAULT_STATE = Path('/tmp/classroom-source-freeze-20261125.json')
TABLES = (
    'profiles', 'classes', 'memberships', 'messages', 'message_likes',
    'board_posts', 'board_replies', 'works', 'shared_files', 'notifications',
)
ROLES = ('anon', 'authenticated')
WRITE_PRIVILEGES = ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
FREEZE_POLICIES = ('classroom_source_freeze_insert', 'classroom_source_freeze_update',
                   'classroom_source_freeze_delete')


def run_query(sql=None, file=None):
    args = ['supabase', 'db', 'query', '--linked']
    args += ['--file', str(file)] if file else [sql]
    result = subprocess.run(args, cwd=SOURCE_DIR, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('Source SQL failed; CLI output suppressed')
    start = result.stdout.find('{')
    if start < 0:
        raise RuntimeError('Supabase query returned no JSON')
    return json.loads(result.stdout[start:])['rows']


def grants():
    table_list = ','.join("'" + name + "'" for name in TABLES)
    sql = ("SELECT table_schema,table_name,grantee,privilege_type "
           "FROM information_schema.role_table_grants WHERE "
           f"((table_schema='public' AND table_name IN ({table_list})) "
           "OR (table_schema='storage' AND table_name='objects')) "
           "AND grantee IN ('anon','authenticated','PUBLIC') "
           "AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE') "
           "ORDER BY table_schema,table_name,grantee,privilege_type")
    return run_query(sql)


def freeze_policies():
    return {row['policyname'] for row in run_query(
        "SELECT policyname FROM pg_policies WHERE schemaname='storage' "
        "AND tablename='objects' AND policyname LIKE 'classroom_source_freeze_%'"
    )}


def write_sql(statements, rollback):
    descriptor, name = tempfile.mkstemp(prefix='classroom-source-freeze-', suffix='.sql')
    os.fchmod(descriptor, 0o600)
    try:
        with os.fdopen(descriptor, 'w') as output:
            output.write('BEGIN;\n' + '\n'.join(statements) + '\n')
            output.write('ROLLBACK;\n' if rollback else 'COMMIT;\n')
        run_query(file=Path(name))
    finally:
        Path(name).unlink(missing_ok=True)


def expected_after_freeze(current):
    return [item for item in current if item['table_schema'] != 'public'
            and not (item['table_schema'] == 'storage' and item['table_name'] == 'objects')]


def freeze_statements():
    statements = [f'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.{table} '
                  'FROM anon, authenticated;' for table in TABLES]
    statements.append('REVOKE INSERT, UPDATE, DELETE ON TABLE storage.objects '
                      'FROM anon, authenticated;')
    statements.extend([
        "CREATE POLICY classroom_source_freeze_insert ON storage.objects AS RESTRICTIVE "
        "FOR INSERT TO anon, authenticated WITH CHECK (bucket_id <> 'uploads');",
        "CREATE POLICY classroom_source_freeze_update ON storage.objects AS RESTRICTIVE "
        "FOR UPDATE TO anon, authenticated USING (bucket_id <> 'uploads') "
        "WITH CHECK (bucket_id <> 'uploads');",
        "CREATE POLICY classroom_source_freeze_delete ON storage.objects AS RESTRICTIVE "
        "FOR DELETE TO anon, authenticated USING (bucket_id <> 'uploads');",
    ])
    return statements


def restore_statements(saved):
    statements = [f'DROP POLICY {name} ON storage.objects;' for name in FREEZE_POLICIES]
    statements.extend(f"GRANT {item['privilege_type']} ON TABLE "
            f"{item['table_schema']}.{item['table_name']} TO {item['grantee']};"
            for item in saved)
    return statements


def save_state(path, saved):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, 'w') as output:
            json.dump({'source_ref': SOURCE_REF, 'grants': saved}, output, indent=2)
            output.write('\n')
    except Exception:
        path.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--unfreeze', action='store_true')
    parser.add_argument('--confirm-source-ref')
    parser.add_argument('--state', type=Path, default=DEFAULT_STATE)
    args = parser.parse_args()
    if (SOURCE_DIR / 'supabase/.temp/project-ref').read_text().strip() != SOURCE_REF:
        parser.error('Linked source project does not match expected ref')
    if args.apply and args.confirm_source_ref != SOURCE_REF:
        parser.error('--apply requires --confirm-source-ref with the source project ref')

    before = grants()
    policies_before = freeze_policies()
    if args.unfreeze:
        if not args.state.exists() or args.state.stat().st_mode & 0o077:
            parser.error('A private freeze state file is required for unfreeze')
        state = json.loads(args.state.read_text())
        if state.get('source_ref') != SOURCE_REF:
            parser.error('Freeze state belongs to a different project')
        saved = state['grants']
        if before or policies_before != set(FREEZE_POLICIES):
            raise RuntimeError('Source write grants changed during freeze; review manually before unfreezing')
        statements = restore_statements(saved)
        write_sql(statements, rollback=not args.apply)
        if args.apply:
            if grants() != saved or freeze_policies():
                raise RuntimeError('Unfreeze grant verification failed; state file retained')
            args.state.unlink()
            print('Source write grants restored; SELECT grants unchanged')
        else:
            print(f'DRY RUN: {len(saved)} write grants would be restored; no persistent changes')
        return

    if args.state.exists():
        parser.error('Freeze state already exists; unfreeze or review it first')
    if policies_before:
        raise RuntimeError('Freeze policy names already exist; review before freezing')
    if any(item['grantee'] == 'PUBLIC' for item in before):
        raise RuntimeError('PUBLIC has write grants; review before freezing')
    statements = freeze_statements()
    if args.apply:
        save_state(args.state, before)
    try:
        write_sql(statements, rollback=not args.apply)
    except Exception:
        if args.apply:
            args.state.unlink(missing_ok=True)
        raise
    if args.apply:
        if grants() != expected_after_freeze(before) or freeze_policies() != set(FREEZE_POLICIES):
            raise RuntimeError('Freeze verification failed; state file retained')
        print(f'Source frozen; {len(before)} write grants saved to {args.state}; SELECT preserved')
    else:
        if grants() != before or freeze_policies() != policies_before:
            raise RuntimeError('ROLLBACK verification failed')
        print(f'DRY RUN: {len(before)} write grants would be revoked; ROLLBACK verified')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
