-- Classroom Share tables in an app-specific schema.
-- Apply to bota-neko's Project only after the Auth user ID mapping is settled.
-- Rollback before data import: DROP SCHEMA classroom_share CASCADE;

CREATE SCHEMA IF NOT EXISTS classroom_share;
REVOKE ALL ON SCHEMA classroom_share FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA classroom_share TO authenticated, service_role;

CREATE TABLE classroom_share.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE classroom_share.classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamp DEFAULT now(),
  join_code text UNIQUE,
  meeting_url text
);

CREATE TABLE classroom_share.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  class_id uuid REFERENCES classroom_share.classes(id) ON DELETE CASCADE,
  role text CHECK (role IN ('admin', 'student')),
  created_at timestamp DEFAULT now(),
  status text DEFAULT 'approved'
);

CREATE TABLE classroom_share.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid REFERENCES classroom_share.classes(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  content text,
  image_url text,
  created_at timestamp DEFAULT now(),
  recipient_id uuid REFERENCES auth.users(id),
  receiver_id uuid REFERENCES auth.users(id)
);

CREATE TABLE classroom_share.message_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid REFERENCES classroom_share.messages(id) ON DELETE CASCADE,
  class_id uuid REFERENCES classroom_share.classes(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (message_id, user_id)
);

CREATE TABLE classroom_share.board_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid REFERENCES classroom_share.classes(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE classroom_share.board_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid REFERENCES classroom_share.board_posts(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE classroom_share.works (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid REFERENCES classroom_share.classes(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  title text,
  image_url text,
  created_at timestamp DEFAULT now()
);

CREATE TABLE classroom_share.shared_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid REFERENCES classroom_share.classes(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  name text NOT NULL,
  file_url text NOT NULL,
  size bigint,
  type text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE classroom_share.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  content text NOT NULL,
  link text,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX memberships_user_class_idx ON classroom_share.memberships(user_id, class_id);
CREATE INDEX memberships_class_status_idx ON classroom_share.memberships(class_id, status);
CREATE INDEX messages_class_created_idx ON classroom_share.messages(class_id, created_at);
CREATE INDEX message_likes_class_idx ON classroom_share.message_likes(class_id);
CREATE INDEX board_posts_class_created_idx ON classroom_share.board_posts(class_id, created_at DESC);
CREATE INDEX board_replies_post_created_idx ON classroom_share.board_replies(post_id, created_at);
CREATE INDEX works_class_created_idx ON classroom_share.works(class_id, created_at DESC);
CREATE INDEX shared_files_class_created_idx ON classroom_share.shared_files(class_id, created_at DESC);
CREATE INDEX notifications_user_created_idx ON classroom_share.notifications(user_id, created_at DESC);

ALTER TABLE classroom_share.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_share.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_share.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_share.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_share.message_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_share.board_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_share.board_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_share.works ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_share.shared_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_share.notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA classroom_share FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA classroom_share TO authenticated, service_role;
