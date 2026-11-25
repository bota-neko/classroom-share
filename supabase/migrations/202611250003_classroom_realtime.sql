-- Purpose: publish class settings and message likes changes for Classroom Share.
-- Rollback: ALTER PUBLICATION supabase_realtime DROP TABLE classroom_share.classes,
--           classroom_share.message_likes;

DO $classroom_realtime$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'classroom_share' AND tablename = 'classes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE classroom_share.classes;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'classroom_share' AND tablename = 'message_likes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE classroom_share.message_likes;
  END IF;
END;
$classroom_realtime$;

-- An author may keep editing only while approved in the destination class.
-- This also prevents an author from assigning a work to a class they cannot access.
ALTER POLICY works_update_author_admin ON classroom_share.works
WITH CHECK (
  (user_id = (SELECT auth.uid()) AND classroom_share.is_approved_member(class_id))
  OR classroom_share.is_class_admin(class_id)
);
