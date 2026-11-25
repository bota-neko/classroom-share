#!/usr/bin/env python3
"""Read-only RLS checks for Classroom Share in the shared Supabase project.

Uses real user IDs from the target database but never reads names or email.
All role impersonation is local to a transaction and rolled back. This checks
that the task management app cannot see classroom data, while a classroom
member can read only their own class.
"""

# TODO: Exercise INSERT/UPDATE/DELETE policies with disposable test accounts.
# TODO: Verify Realtime and browser login after the production cutover.

import json
import subprocess
import sys
import uuid
from pathlib import Path

TARGET_DIR = Path('/tmp/classroom-migrate-target')
TARGET_REF = 'fktqwohvwxlkscwyvlqh'
TABLES = (
    'profiles', 'classes', 'memberships', 'messages', 'message_likes',
    'board_posts', 'board_replies', 'works', 'shared_files', 'notifications',
)


def query(sql, expect_denied=False):
    result = subprocess.run(
        ['supabase', 'db', 'query', '--linked', sql], cwd=TARGET_DIR,
        capture_output=True, text=True, check=False,
    )
    if expect_denied:
        # 42501 is PostgreSQL's insufficient_privilege error.
        return result.returncode != 0 and '42501' in (result.stderr + result.stdout)
    if result.returncode:
        raise RuntimeError('Target SQL query failed; details suppressed')
    start = result.stdout.find('{')
    if start < 0:
        raise RuntimeError('Target SQL query returned no JSON')
    return json.loads(result.stdout[start:])['rows']


def access_as(user_id, select_sql):
    user_id = str(uuid.UUID(user_id))
    return query(
        'BEGIN; SET LOCAL ROLE authenticated; '
        f"SELECT set_config('request.jwt.claim.sub','{user_id}',true); "
        + select_sql + '; ROLLBACK;'
    )


def count_as(user_id, table, class_id=None):
    if table not in TABLES:
        raise ValueError('Unknown table')
    clause = ''
    if class_id:
        clause = f" WHERE id='{uuid.UUID(class_id)}'::uuid"
    result = access_as(
        user_id,
        f'SELECT count(*) AS n FROM classroom_share.{table}{clause}',
    )
    return int(result[0]['n'])


def main():
    linked = (TARGET_DIR / 'supabase/.temp/project-ref').read_text().strip()
    if linked != TARGET_REF:
        raise RuntimeError('Target link is not bota-neko\'s Project')

    candidates = query("""
        SELECT
          (SELECT u.id FROM auth.users u
           WHERE NOT EXISTS (SELECT 1 FROM classroom_share.profiles p
                             WHERE p.id = u.id)
           LIMIT 1) AS task_only_id,
          m.user_id AS member_id,
          m.class_id AS own_class_id,
          other.id AS foreign_class_id
        FROM classroom_share.memberships m
        JOIN classroom_share.classes other ON other.id <> m.class_id
        WHERE m.status = 'approved'
          AND NOT EXISTS (
            SELECT 1 FROM classroom_share.memberships x
            WHERE x.user_id = m.user_id AND x.class_id = other.id
          )
          AND other.created_by IS DISTINCT FROM m.user_id
        LIMIT 1
    """)
    if not candidates or not candidates[0]['task_only_id']:
        raise RuntimeError('Need one task-only user and one member with another class')
    case = candidates[0]
    failures = []

    if not query(
        'BEGIN; SET LOCAL ROLE anon; '
        'SELECT count(*) FROM classroom_share.classes; ROLLBACK;',
        expect_denied=True,
    ):
        failures.append('anon can access classroom_share.classes')
    print('anon: schema access denied')

    # A user of the pre-existing task app must see none of the classroom rows.
    for table in TABLES:
        visible = count_as(case['task_only_id'], table)
        if visible != 0:
            failures.append(f'task-only user sees {table}')
    print(f'task-only user: checked {len(TABLES)} tables')

    own_visible = count_as(case['member_id'], 'classes', case['own_class_id'])
    foreign_visible = count_as(case['member_id'], 'classes',
                               case['foreign_class_id'])
    if own_visible != 1:
        failures.append('member cannot see their own class')
    if foreign_visible != 0:
        failures.append('member can see a foreign class')
    print('class member: own class visible; foreign class hidden')

    if failures:
        for failure in failures:
            print('FAIL:', failure, file=sys.stderr)
        return 1
    print('PASS: tested read access follows classroom boundaries')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
