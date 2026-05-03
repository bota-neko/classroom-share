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

type LikeState = { count: number; liked: boolean };

type ChatProps = {
  classId: string;
  currentUserId: string;
  currentDisplayName: string;
  bubbleColor: string;
};

export default function Chat({
  classId,
  currentUserId,
  currentDisplayName,
  bubbleColor,
}: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<Map<string, string>>(new Map());
  const [likes, setLikes] = useState<Map<string, LikeState>>(new Map());
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);
  const initialLoad = useRef(true);

  const scrollToBottom = (smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "instant" });
  };

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    isAtBottom.current = atBottom;
    if (atBottom) setUnreadCount(0);
  };

  useEffect(() => {
    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("class_id", classId)
        .order("created_at", { ascending: true });

      if (error) {
        setLoading(false);
        return;
      }
      const msgs = data || [];
      setMessages(msgs);

      const profileMap = await fetchProfiles(msgs.map((m) => m.user_id));
      profileMap.set(currentUserId, currentDisplayName);
      setProfiles(profileMap);

      // いいね取得
      if (msgs.length > 0) {
        const { data: likesData } = await supabase
          .from("message_likes")
          .select("message_id, user_id")
          .in("message_id", msgs.map((m) => m.id));

        if (likesData) {
          const map = new Map<string, LikeState>();
          likesData.forEach((l) => {
            const cur = map.get(l.message_id) || { count: 0, liked: false };
            map.set(l.message_id, {
              count: cur.count + 1,
              liked: cur.liked || l.user_id === currentUserId,
            });
          });
          setLikes(map);
        }
      }

      setLoading(false);
    };

    fetchMessages();

    const channel = supabase
      .channel(`messages-${classId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `class_id=eq.${classId}`,
      }, async (payload) => {
        const newMsg = payload.new as Message;
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
        if (!isAtBottom.current) setUnreadCount((n) => n + 1);
        setProfiles((prev) => {
          if (prev.has(newMsg.user_id)) return prev;
          fetchProfiles([newMsg.user_id]).then((np) => {
            setProfiles((p) => {
              const merged = new Map(p);
              np.forEach((v, k) => merged.set(k, v));
              return merged;
            });
          });
          return prev;
        });
      })
      .on("postgres_changes", {
        event: "DELETE",
        schema: "public",
        table: "messages",
        filter: `class_id=eq.${classId}`,
      }, (payload) => {
        setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
      })
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "message_likes",
        filter: `class_id=eq.${classId}`,
      }, (payload) => {
        const { message_id, user_id } = payload.new as { message_id: string; user_id: string };
        if (user_id === currentUserId) return; // 楽観的更新済みのためスキップ
        setLikes((prev) => {
          const cur = prev.get(message_id) || { count: 0, liked: false };
          const next = new Map(prev);
          next.set(message_id, { count: cur.count + 1, liked: cur.liked });
          return next;
        });
      })
      .on("postgres_changes", {
        event: "DELETE",
        schema: "public",
        table: "message_likes",
        filter: `class_id=eq.${classId}`,
      }, (payload) => {
        const { message_id, user_id } = payload.old as { message_id: string; user_id: string };
        if (user_id === currentUserId) return; // 楽観的更新済みのためスキップ
        setLikes((prev) => {
          const cur = prev.get(message_id);
          if (!cur) return prev;
          const next = new Map(prev);
          next.set(message_id, { count: Math.max(0, cur.count - 1), liked: cur.liked });
          return next;
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  useEffect(() => {
    if (loading) return;
    if (initialLoad.current) {
      scrollToBottom(false);
      initialLoad.current = false;
      return;
    }
    if (isAtBottom.current) scrollToBottom(true);
  }, [messages, loading]);

  const handleSend = async (content: string, imageUrl: string | null) => {
    const { error } = await supabase.from("messages").insert({
      class_id: classId,
      user_id: currentUserId,
      content,
      image_url: imageUrl,
    });
    if (error) { alert("送信に失敗しました: " + error.message); return; }

    isAtBottom.current = true;
    setUnreadCount(0);

    const { data: members } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("class_id", classId)
      .neq("user_id", currentUserId);

    if (members && members.length > 0) {
      await supabase.from("notifications").insert(
        members.map((m) => ({
          user_id: m.user_id,
          type: "chat",
          content: `${currentDisplayName}さんが「${content.substring(0, 20)}${content.length > 20 ? "..." : ""}」と発言しました`,
          link: `/class/${classId}?tab=chat`,
        }))
      );
    }
  };

  const handleDelete = async (messageId: string) => {
    const { error } = await supabase
      .from("messages")
      .delete()
      .eq("id", messageId)
      .eq("user_id", currentUserId);
    if (error) return;
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  };

  const handleLike = async (messageId: string) => {
    const cur = likes.get(messageId);
    const isLiked = cur?.liked ?? false;

    // 楽観的更新
    setLikes((prev) => {
      const c = prev.get(messageId) || { count: 0, liked: false };
      const next = new Map(prev);
      next.set(messageId, {
        count: isLiked ? Math.max(0, c.count - 1) : c.count + 1,
        liked: !isLiked,
      });
      return next;
    });

    if (isLiked) {
      await supabase.from("message_likes")
        .delete()
        .eq("message_id", messageId)
        .eq("user_id", currentUserId);
    } else {
      await supabase.from("message_likes").insert({
        message_id: messageId,
        class_id: classId,
        user_id: currentUserId,
      });
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-gray-500 text-sm">最初のメッセージを送ってみよう</p>
            </div>
          ) : (
            messages.map((msg) => (
              <MessageItem
                key={msg.id}
                message={msg}
                currentUserId={currentUserId}
                displayName={profiles.get(msg.user_id) || "ユーザー"}
                onDelete={handleDelete}
                onLike={handleLike}
                likeCount={likes.get(msg.id)?.count ?? 0}
                liked={likes.get(msg.id)?.liked ?? false}
                bubbleColor={bubbleColor}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {unreadCount > 0 && (
        <div className="relative">
          <button
            onClick={() => { isAtBottom.current = true; setUnreadCount(0); scrollToBottom(true); }}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-4 py-2 bg-black text-white text-xs font-medium rounded-full shadow-lg hover:bg-gray-800 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
            {unreadCount}件の新しいメッセージ
          </button>
        </div>
      )}

      <MessageInput onSend={handleSend} />
    </div>
  );
}
