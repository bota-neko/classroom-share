import { supabase, supabaseSchema } from "./supabase";

export type ClassroomNotification = {
  user_id: string;
  type: string;
  content: string;
  link: string;
};

// 統合先では通知先とクラス所属を検証する RPC を経由する。
export async function sendClassroomNotifications(
  classId: string,
  notifications: ClassroomNotification[],
): Promise<void> {
  if (notifications.length === 0) return;
  if (supabaseSchema === "public") {
    const { error } = await supabase.from("notifications").insert(notifications);
    if (error) throw error;
    return;
  }

  const results = await Promise.all(
    notifications.map((notification) =>
      supabase.rpc("create_notification", {
        p_class_id: classId,
        p_target_id: notification.user_id,
        p_type: notification.type,
        p_content: notification.content,
        p_link: notification.link,
      }),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
}
