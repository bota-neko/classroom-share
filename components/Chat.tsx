"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchProfiles } from "@/lib/profiles";
import MessageItem from "./MessageItem";
import MessageInput from "./MessageInput";

type Message = {
  id: string;
  class_id: string;
  user_id: string;
  content: string;
  image_url: string | null;
  created_at: string;
};

type ChatProps = {
  classId: string;
  currentUserId: string;
  currentDisplayName: string;
};

export default function Chat({
  classId,
  currentUserId,
  currentDisplayName,
}: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("class_id", classId)
        .order("created_at", { ascending: true });

      if (error) {
        console.log("メッセージ取得エラー:", error);
        setLoading(false);
        return;
      }
      const msgs = data || [];
      setMessages(msgs);

      const userIds = msgs.map((m) => m.user_id);
      const profileMap = await fetchProfiles(userIds);
      // 自分の名前も追加
      profileMap.set(currentUserId, currentDisplayName);
      setProfiles(profileMap);
      setLoading(false);
    };

    fetchMessages();

    // Realtime購読
    const channel = supabase
      .channel(`messages-${classId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `class_id=eq.${classId}`,
        },
        async (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });

          // 新規ユーザーのプロフィール取得
          setProfiles((prev) => {
            if (prev.has(newMsg.user_id)) return prev;
            fetchProfiles([newMsg.user_id]).then((newProfiles) => {
              setProfiles((p) => {
                const merged = new Map(p);
                newProfiles.forEach((v, k) => merged.set(k, v));
                return merged;
              });
            });
            return prev;
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "messages",
          filter: `class_id=eq.${classId}`,
        },
        (payload) => {
          const deletedId = payload.old.id;
          setMessages((prev) => prev.filter((m) => m.id !== deletedId));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (content: string, imageUrl: string | null) => {
    const { error } = await supabase
      .from("messages")
      .insert({
        class_id: classId,
        user_id: currentUserId,
        content,
        image_url: imageUrl,
      });

    if (error) {
      console.log("投稿エラー:", error);
      alert("送信に失敗しました: " + error.message);
      return;
    }

    // 他のメンバー全員に通知を送る
    const { data: members } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("class_id", classId)
      .neq("user_id", currentUserId);

    if (members && members.length > 0) {
      const notifications = members.map((m) => ({
        user_id: m.user_id,
        type: "chat",
        content: `${currentDisplayName}さんが「${content.substring(0, 20)}${content.length > 20 ? "..." : ""}」と発言しました`,
        link: `/class/${classId}?tab=chat`,
      }));
      const { error: nError } = await supabase.from("notifications").insert(notifications);
      if (nError) console.error("通知作成エラー:", nError);
    }
  };

  const handleDelete = async (messageId: string) => {
    const { error } = await supabase
      .from("messages")
      .delete()
      .eq("id", messageId)
      .eq("user_id", currentUserId);

    if (error) {
      console.log("削除エラー:", error);
      return;
    }
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-gray-500 text-sm">
                最初のメッセージを送ってみよう
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <MessageItem
                key={msg.id}
                message={msg}
                currentUserId={currentUserId}
                displayName={profiles.get(msg.user_id) || "ユーザー"}
                onDelete={handleDelete}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      <MessageInput onSend={handleSend} />
    </div>
  );
}
