-- Classroom Share access rules. Run after 0001, before importing data.
-- Rollback before cutover: DROP SCHEMA classroom_share CASCADE; DROP POLICY IF EXISTS classroom_upload_insert ON storage.objects;

CREATE FUNCTION classroom_share.is_class_admin(p_class_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM classroom_share.classes c
    WHERE c.id = p_class_id AND c.created_by = (SELECT auth.uid())
  );
$$;

CREATE FUNCTION classroom_share.is_approved_member(p_class_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM classroom_share.memberships m
    WHERE m.class_id = p_class_id AND m.user_id = (SELECT auth.uid())
      AND m.status = 'approved'
  );
$$;

REVOKE ALL ON FUNCTION classroom_share.is_class_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_share.is_approved_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_share.is_class_admin(uuid), classroom_share.is_approved_member(uuid) TO authenticated;

-- A signed-in user may read only classmate profiles and their own profile.
CREATE POLICY profiles_select_classmates ON classroom_share.profiles FOR SELECT TO authenticated
USING (id = (SELECT auth.uid()) OR EXISTS (
  SELECT 1 FROM classroom_share.memberships own_m
  JOIN classroom_share.memberships peer_m ON peer_m.class_id = own_m.class_id
  WHERE own_m.user_id = (SELECT auth.uid()) AND own_m.status = 'approved'
    AND peer_m.user_id = profiles.id AND peer_m.status = 'approved'
  ) OR EXISTS (
  SELECT 1 FROM classroom_share.classes c
  JOIN classroom_share.memberships peer_m ON peer_m.class_id = c.id
  WHERE c.created_by = (SELECT auth.uid()) AND peer_m.user_id = profiles.id
));
CREATE POLICY profiles_insert_own ON classroom_share.profiles FOR INSERT TO authenticated
WITH CHECK (id = (SELECT auth.uid()));
CREATE POLICY profiles_update_own ON classroom_share.profiles FOR UPDATE TO authenticated
USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY classes_select_member ON classroom_share.classes FOR SELECT TO authenticated
USING (created_by = (SELECT auth.uid()) OR classroom_share.is_approved_member(id));
CREATE POLICY classes_insert_owner ON classroom_share.classes FOR INSERT TO authenticated
WITH CHECK (created_by = (SELECT auth.uid()));
CREATE POLICY classes_update_owner ON classroom_share.classes FOR UPDATE TO authenticated
USING (created_by = (SELECT auth.uid())) WITH CHECK (created_by = (SELECT auth.uid()));
CREATE POLICY classes_delete_owner ON classroom_share.classes FOR DELETE TO authenticated
USING (created_by = (SELECT auth.uid()));

CREATE POLICY memberships_select_class ON classroom_share.memberships FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR classroom_share.is_class_admin(class_id)
  OR classroom_share.is_approved_member(class_id));
CREATE POLICY memberships_insert_request ON classroom_share.memberships FOR INSERT TO authenticated
WITH CHECK (
  (user_id = (SELECT auth.uid()) AND role = 'student' AND status = 'pending')
  OR (user_id = (SELECT auth.uid()) AND role = 'admin' AND status = 'approved'
      AND classroom_share.is_class_admin(class_id))
);
CREATE POLICY memberships_update_admin ON classroom_share.memberships FOR UPDATE TO authenticated
USING (classroom_share.is_class_admin(class_id))
WITH CHECK (classroom_share.is_class_admin(class_id));
CREATE POLICY memberships_delete_admin ON classroom_share.memberships FOR DELETE TO authenticated
USING (classroom_share.is_class_admin(class_id));

CREATE POLICY messages_select_visible ON classroom_share.messages FOR SELECT TO authenticated
USING (classroom_share.is_approved_member(class_id) AND
  (receiver_id IS NULL OR receiver_id = (SELECT auth.uid()) OR user_id = (SELECT auth.uid())));
CREATE POLICY messages_insert_member ON classroom_share.messages FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()) AND classroom_share.is_approved_member(class_id)
  AND (receiver_id IS NULL OR EXISTS (
    SELECT 1 FROM classroom_share.memberships m
    WHERE m.class_id = messages.class_id AND m.user_id = messages.receiver_id
      AND m.status = 'approved'
  )));
CREATE POLICY messages_delete_own ON classroom_share.messages FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE POLICY likes_select_visible ON classroom_share.message_likes FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM classroom_share.messages msg
  WHERE msg.id = message_likes.message_id AND msg.class_id = message_likes.class_id));
CREATE POLICY likes_insert_own ON classroom_share.message_likes FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (
  SELECT 1 FROM classroom_share.messages msg
  WHERE msg.id = message_likes.message_id AND msg.class_id = message_likes.class_id
));
CREATE POLICY likes_delete_own ON classroom_share.message_likes FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE POLICY posts_select_member ON classroom_share.board_posts FOR SELECT TO authenticated
USING (classroom_share.is_approved_member(class_id));
CREATE POLICY posts_insert_member ON classroom_share.board_posts FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()) AND classroom_share.is_approved_member(class_id));
CREATE POLICY posts_delete_author_admin ON classroom_share.board_posts FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()) OR classroom_share.is_class_admin(class_id));

CREATE POLICY replies_select_member ON classroom_share.board_replies FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM classroom_share.board_posts p WHERE p.id = board_replies.post_id));
CREATE POLICY replies_insert_member ON classroom_share.board_replies FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (
  SELECT 1 FROM classroom_share.board_posts p WHERE p.id = board_replies.post_id
));
CREATE POLICY replies_delete_author_admin ON classroom_share.board_replies FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()) OR EXISTS (
  SELECT 1 FROM classroom_share.board_posts p
  WHERE p.id = board_replies.post_id AND classroom_share.is_class_admin(p.class_id)
));

CREATE POLICY works_select_member ON classroom_share.works FOR SELECT TO authenticated
USING (classroom_share.is_approved_member(class_id));
CREATE POLICY works_insert_member ON classroom_share.works FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()) AND classroom_share.is_approved_member(class_id));
CREATE POLICY works_update_author_admin ON classroom_share.works FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()) OR classroom_share.is_class_admin(class_id))
WITH CHECK (user_id = (SELECT auth.uid()) OR classroom_share.is_class_admin(class_id));
CREATE POLICY works_delete_author_admin ON classroom_share.works FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()) OR classroom_share.is_class_admin(class_id));

CREATE POLICY files_select_member ON classroom_share.shared_files FOR SELECT TO authenticated
USING (classroom_share.is_approved_member(class_id));
CREATE POLICY files_insert_member ON classroom_share.shared_files FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()) AND classroom_share.is_approved_member(class_id));
CREATE POLICY files_delete_author_admin ON classroom_share.shared_files FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()) OR classroom_share.is_class_admin(class_id));

CREATE POLICY notifications_select_own ON classroom_share.notifications FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));
CREATE POLICY notifications_update_own ON classroom_share.notifications FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- A join code is the invitation secret. This RPC reveals one matching class only.
CREATE FUNCTION classroom_share.find_class_by_join_code(p_code text)
RETURNS TABLE (id uuid, name text, created_by uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT c.id, c.name, c.created_by FROM classroom_share.classes c
  WHERE c.join_code = upper(trim(p_code)) AND (SELECT auth.uid()) IS NOT NULL
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION classroom_share.find_class_by_join_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_share.find_class_by_join_code(text) TO authenticated;

-- Pending applicants receive a limited dashboard summary without meeting_url.
CREATE FUNCTION classroom_share.my_class_summaries()
RETURNS TABLE (id uuid, name text, join_code text, role text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT c.id, c.name, c.join_code, m.role, m.status
  FROM classroom_share.memberships m
  JOIN classroom_share.classes c ON c.id = m.class_id
  WHERE m.user_id = (SELECT auth.uid());
$$;
REVOKE ALL ON FUNCTION classroom_share.my_class_summaries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_share.my_class_summaries() TO authenticated;

-- Browser clients cannot insert arbitrary notifications. The RPC validates both parties.
CREATE FUNCTION classroom_share.create_notification(
  p_class_id uuid, p_target_id uuid, p_type text, p_content text, p_link text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR p_class_id IS NULL OR p_target_id IS NULL
    OR p_type IS NULL OR p_type NOT IN ('join_request', 'approved', 'chat', 'work', 'file')
    OR p_content IS NULL OR length(p_content) > 1000
    OR p_link IS NULL OR p_link NOT LIKE '/class/' || p_class_id::text || '%' THEN
    RAISE EXCEPTION 'Invalid notification';
  END IF;
  IF NOT (
    (p_type = 'join_request' AND classroom_share.is_class_admin(p_class_id) = false
      AND EXISTS (SELECT 1 FROM classroom_share.memberships m
        WHERE m.class_id = p_class_id AND m.user_id = (SELECT auth.uid()) AND m.status = 'pending')
      AND EXISTS (SELECT 1 FROM classroom_share.classes c
        WHERE c.id = p_class_id AND c.created_by = p_target_id))
    OR
    (p_type = 'approved' AND classroom_share.is_class_admin(p_class_id)
      AND EXISTS (SELECT 1 FROM classroom_share.memberships m
        WHERE m.class_id = p_class_id AND m.user_id = p_target_id))
    OR
    (p_type IN ('chat', 'work', 'file') AND
      (classroom_share.is_approved_member(p_class_id) OR classroom_share.is_class_admin(p_class_id))
      AND EXISTS (SELECT 1 FROM classroom_share.memberships m
        WHERE m.class_id = p_class_id AND m.user_id = p_target_id))
  ) THEN
    RAISE EXCEPTION 'Notification access denied';
  END IF;
  INSERT INTO classroom_share.notifications(user_id, type, content, link)
  VALUES (p_target_id, p_type, p_content, p_link);
END;
$$;
REVOKE ALL ON FUNCTION classroom_share.create_notification(uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_share.create_notification(uuid,uuid,text,text,text) TO authenticated;

-- Public file reads preserve existing getPublicUrl behavior. Uploads require class membership.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('classroom-uploads', 'classroom-uploads', true, 52428800)
ON CONFLICT (id) DO NOTHING;

CREATE FUNCTION classroom_share.can_upload(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  parts text[] := string_to_array(p_name, '/');
  class_id uuid;
BEGIN
  IF array_length(parts, 1) < 4 OR parts[1] NOT IN ('messages', 'works', 'files')
    OR parts[2] !~ '^[0-9a-fA-F-]{36}$' OR parts[3] <> (SELECT auth.uid())::text THEN
    RETURN false;
  END IF;
  class_id := parts[2]::uuid;
  RETURN classroom_share.is_approved_member(class_id);
EXCEPTION WHEN invalid_text_representation THEN
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION classroom_share.can_upload(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_share.can_upload(text) TO authenticated;

CREATE POLICY classroom_upload_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'classroom-uploads' AND classroom_share.can_upload(name));

-- Realtime subscriptions in the app depend on Postgres changes for these tables.
ALTER PUBLICATION supabase_realtime ADD TABLE classroom_share.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE classroom_share.board_replies;
ALTER PUBLICATION supabase_realtime ADD TABLE classroom_share.works;
ALTER PUBLICATION supabase_realtime ADD TABLE classroom_share.shared_files;
ALTER PUBLICATION supabase_realtime ADD TABLE classroom_share.memberships;
ALTER PUBLICATION supabase_realtime ADD TABLE classroom_share.notifications;
