#!/usr/bin/env python3
"""Check Classroom Share write policies without retaining any test data.

Each SQL case runs as an authenticated user inside a transaction. Successful
cases end in ROLLBACK; rejected cases abort their transaction automatically.
Random IDs identify test rows so a final check can prove nothing was saved.
"""

# TODO: Exercise every update/delete policy and a real Storage API upload.

import json
import subprocess
import sys
import uuid
from pathlib import Path

TARGET_DIR = Path('/tmp/classroom-migrate-target')
TARGET_REF = 'fktqwohvwxlkscwyvlqh'


def query(sql):
    for attempt in range(3):
        try:
            result = subprocess.run(
                ['supabase', 'db', 'query', '--linked', sql], cwd=TARGET_DIR,
                capture_output=True, text=True, check=False, timeout=30,
            )
            break
        except subprocess.TimeoutExpired:
            if attempt == 2:
                raise RuntimeError('Target SQL timed out 3 times') from None
    if result.returncode:
        return None, result.stdout + result.stderr
    start = result.stdout.find('{')
    if start < 0:
        raise RuntimeError('Target query returned no JSON')
    return json.loads(result.stdout[start:])['rows'], None


def as_user(user_id, statement):
    user_id = str(uuid.UUID(user_id))
    return query(
        'BEGIN; SET LOCAL ROLE authenticated; '
        f"SELECT set_config('request.jwt.claim.sub','{user_id}',true); "
        + statement + '; SELECT true AS completed; ROLLBACK;'
    )


def check(label, user_id, statement, should_allow, failures):
    rows, error = as_user(user_id, statement)
    if should_allow:
        passed = error is None and rows == [{'completed': True}]
    else:
        passed = error is not None and (
            '42501' in error or 'P0001' in error
        )
    print(('PASS' if passed else 'FAIL') + ': ' + label)
    if not passed:
        failures.append(label)


def main():
    linked = (TARGET_DIR / 'supabase/.temp/project-ref').read_text().strip()
    if linked != TARGET_REF:
        raise RuntimeError('Target link is not bota-neko\'s Project')
    candidates, error = query("""
        SELECT c.id AS class_id, c.created_by AS admin_id,
               m.user_id AS member_id,
               (SELECT u.id FROM auth.users u WHERE NOT EXISTS (
                   SELECT 1 FROM classroom_share.profiles p WHERE p.id = u.id
               ) LIMIT 1) AS outsider_id
        FROM classroom_share.classes c
        JOIN classroom_share.memberships m ON m.class_id = c.id
          AND m.role = 'student' AND m.status = 'approved'
        WHERE EXISTS (
          SELECT 1 FROM classroom_share.memberships a
          WHERE a.class_id = c.id AND a.user_id = c.created_by
            AND a.role = 'admin' AND a.status = 'approved'
        )
        LIMIT 1
    """)
    if error or not candidates or not candidates[0]['outsider_id']:
        raise RuntimeError('Need an approved student, class admin, and outsider')
    case = candidates[0]
    class_id = str(uuid.UUID(case['class_id']))
    admin = str(uuid.UUID(case['admin_id']))
    member = str(uuid.UUID(case['member_id']))
    outsider = str(uuid.UUID(case['outsider_id']))
    new_class = str(uuid.uuid4())
    new_membership = str(uuid.uuid4())
    new_message = str(uuid.uuid4())
    storage_name = f'messages/{class_id}/{member}/qa-{uuid.uuid4()}.txt'
    bad_storage_name = f'messages/{class_id}/{outsider}/qa-{uuid.uuid4()}.txt'
    marker = 'qa-rollback-' + str(uuid.uuid4())
    failures = []

    check('class creator can create a class', outsider,
          f"INSERT INTO classroom_share.classes(id,name,created_by,join_code) "
          f"VALUES ('{new_class}'::uuid,'QA rollback','{outsider}'::uuid,"
          f"'{new_class[:8]}')", True, failures)
    check('creator cannot impersonate another owner', outsider,
          f"INSERT INTO classroom_share.classes(id,name,created_by,join_code) "
          f"VALUES ('{new_class}'::uuid,'QA rollback','{admin}'::uuid,"
          f"'{new_class[:8]}')", False, failures)
    check('outsider can request student membership', outsider,
          f"INSERT INTO classroom_share.memberships(id,user_id,class_id,role,status) "
          f"VALUES ('{new_membership}'::uuid,'{outsider}'::uuid,"
          f"'{class_id}'::uuid,'student','pending')", True, failures)
    check('outsider cannot self-appoint admin', outsider,
          f"INSERT INTO classroom_share.memberships(id,user_id,class_id,role,status) "
          f"VALUES ('{new_membership}'::uuid,'{outsider}'::uuid,"
          f"'{class_id}'::uuid,'admin','approved')", False, failures)
    check('approved member can post to own class', member,
          f"INSERT INTO classroom_share.messages(id,class_id,user_id,content) "
          f"VALUES ('{new_message}'::uuid,'{class_id}'::uuid,"
          f"'{member}'::uuid,'{marker}')", True, failures)
    check('outsider cannot post to class', outsider,
          f"INSERT INTO classroom_share.messages(id,class_id,user_id,content) "
          f"VALUES ('{new_message}'::uuid,'{class_id}'::uuid,"
          f"'{outsider}'::uuid,'{marker}')", False, failures)
    check('member can notify class admin', member,
          f"SELECT classroom_share.create_notification('{class_id}'::uuid,"
          f"'{admin}'::uuid,'chat','{marker}','/class/{class_id}')",
          True, failures)
    check('member cannot notify outsider', member,
          f"SELECT classroom_share.create_notification('{class_id}'::uuid,"
          f"'{outsider}'::uuid,'chat','{marker}','/class/{class_id}')",
          False, failures)
    check('member can upload in own class/user path', member,
          f"INSERT INTO storage.objects(bucket_id,name,owner_id) "
          f"VALUES ('classroom-uploads','{storage_name}','{member}')",
          True, failures)
    check('member cannot upload under another user path', member,
          f"INSERT INTO storage.objects(bucket_id,name,owner_id) "
          f"VALUES ('classroom-uploads','{bad_storage_name}','{member}')",
          False, failures)

    residual, error = query(
        'SELECT '
        f"(SELECT count(*) FROM classroom_share.classes WHERE id='{new_class}'::uuid) AS classes, "
        f"(SELECT count(*) FROM classroom_share.memberships WHERE id='{new_membership}'::uuid) AS memberships, "
        f"(SELECT count(*) FROM classroom_share.messages WHERE id='{new_message}'::uuid) AS messages, "
        f"(SELECT count(*) FROM classroom_share.notifications WHERE content='{marker}') AS notifications, "
        f"(SELECT count(*) FROM storage.objects WHERE bucket_id='classroom-uploads' "
        f"AND name IN ('{storage_name}','{bad_storage_name}')) AS objects"
    )
    if error or not residual or any(int(value) for value in residual[0].values()):
        failures.append('test rows were retained')
    print(('PASS' if 'test rows were retained' not in failures else 'FAIL')
          + ': all test writes rolled back')
    if failures:
        print(f'{len(failures)} write-policy checks failed', file=sys.stderr)
        return 1
    print('PASS: major write policies allow intended actions and reject misuse')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
