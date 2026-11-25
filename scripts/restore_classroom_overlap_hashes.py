#!/usr/bin/env python3
"""Restore only pre-migration password hashes for overlapping target Auth users."""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

TARGET_DIR = Path('/tmp/classroom-migrate-target')
TARGET_REF = 'fktqwohvwxlkscwyvlqh'
DEFAULT_BACKUP = Path('/tmp/classroom-migrate-backup-20261125/target_overlap_auth_users.json')


def literal(value):
    if value is None:
        return 'NULL'
    return "'" + str(value).replace("'", "''") + "'"


def query(sql=None, file=None):
    args = ['supabase', 'db', 'query', '--linked']
    args += ['--file', str(file)] if file else [sql]
    result = subprocess.run(args, cwd=TARGET_DIR, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('Target Auth query failed; SQL output suppressed to protect hashes')
    return json.loads(result.stdout[result.stdout.find('{'):])['rows']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup', type=Path, default=DEFAULT_BACKUP)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--confirm-target-ref')
    args = parser.parse_args()
    if (TARGET_DIR / 'supabase/.temp/project-ref').read_text().strip() != TARGET_REF:
        parser.error('Linked target ref changed')
    if args.apply and args.confirm_target_ref != TARGET_REF:
        parser.error('--apply requires --confirm-target-ref')
    if args.backup.stat().st_mode & 0o077:
        parser.error('Backup must be owner-only (0600)')
    records = json.loads(args.backup.read_text())
    users = [item['row'] for item in records]
    if len(users) != 2 or any(not all(k in u for k in ('id', 'email', 'encrypted_password')) for u in users):
        parser.error('Backup must contain exactly two Auth user records')
    print('Overlapping target users in backup: 2')
    if not args.apply:
        print('DRY RUN: no target Auth records changed')
        return
    statements = ['BEGIN;']
    for user in users:
        statements.append('DO $classroom_restore$ BEGIN UPDATE auth.users SET encrypted_password = '
                          + literal(user['encrypted_password']) + ' WHERE id = '
                          + literal(user['id']) + '::uuid AND lower(email) = '
                          + literal(user['email'].lower())
                          + "; IF NOT FOUND THEN RAISE EXCEPTION 'Restore target missing'; END IF; END $classroom_restore$;")
    statements.append('COMMIT;')
    descriptor, temp_name = tempfile.mkstemp(prefix='classroom-auth-restore-', suffix='.sql')
    os.fchmod(descriptor, 0o600)
    try:
        with os.fdopen(descriptor, 'w') as output:
            output.write('\n'.join(statements) + '\n')
        query(file=Path(temp_name))
    finally:
        Path(temp_name).unlink(missing_ok=True)
    for user in users:
        stored = query('SELECT encrypted_password FROM auth.users WHERE id = '
                       + literal(user['id']) + '::uuid')
        if len(stored) != 1 or stored[0]['encrypted_password'] != user['encrypted_password']:
            raise RuntimeError('Post-restore hash verification failed')
    print('Two password hashes restored and verified; public tables unchanged')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
