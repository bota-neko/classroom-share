"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchProfiles } from "@/lib/profiles";
import MessageItem from "./MessageItem";
import MessageInput from "./MessageInput";
import Avatar from "./Avatar";

type Message = {
  id: string;
  class_id: string;
  user_id: string;
  content: string;
  image_url: string | null;
  receiver_id: string | null;
  created_at: string;
};

type Member = {
  user_id: string;
  name: string;
  role: string;
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
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [showSidebarMobile, setShowSidebarMobile] = useState(false);
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
      let query = supabase
        .from("messages")
        .select("*")
        .eq("class_id", classId);

      if (selectedMemberId) {
        // 個別メッセージ: (自分->相手) OR (相手->自分)
        query = query.or(
          `and(user_id.eq.${currentUserId},receiver_id.eq.${selectedMemberId}),and(user_id.eq.${selectedMemberId},receiver_id.eq.${currentUserId})`
        );
      } else {
        // 全員向けメッセージ
        query = query.is("receiver_id", null);
      }

      const { data, error } = await query.order("created_at", { ascending: true });

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

    const fetchMembersList = async () => {
      const { data } = await supabase
        .from("memberships")
        .select("user_id, role")
        .eq("class_id", classId)
        .eq("status", "approved");

      if (data) {
        const uids = data.map((m) => m.user_id);
        const pMap = await fetchProfiles(uids);
        const memberList = data.map((m) => ({
          user_id: m.user_id,
          name: pMap.get(m.user_id) || "ユーザー",
          role: m.role,
        }));
        setMembers(memberList.filter((m) => m.user_id !== currentUserId));
      }
    };

    fetchMessages();
    fetchMembersList();

    const channel = supabase
      .channel(`messages-${classId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `class_id=eq.${classId}`,
      }, async (payload) => {
        const newMsg = payload.new as Message;
        // フィルタリング: 現在の表示モード（全員 or 特定個人）に一致する場合のみ追加
        const isMatch = selectedMemberId
          ? (newMsg.receiver_id === selectedMemberId && newMsg.user_id === currentUserId) ||
          (newMsg.receiver_id === currentUserId && newMsg.user_id === selectedMemberId)
          : newMsg.receiver_id === null;

        if (isMatch) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          if (!isAtBottom.current) setUnreadCount((n) => n + 1);
        }
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
  }, [classId, selectedMemberId]);

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
      receiver_id: selectedMemberId,
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
    <div className="h-full">
      <div className="max-w-6xl mx-auto h-full flex bg-white border-gray-200 overflow-hidden relative">
        {/* サイドバー (デスクトップ: 固定, スマホ: オーバーレイ) */}
        <div className={`
          ${showSidebarMobile ? "translate-x-0" : "-translate-x-full sm:translate-x-0"}
          fixed sm:relative inset-y-0 left-0 w-64 border-r border-gray-100 flex flex-col bg-white sm:bg-gray-50/30 z-50 transition-transform duration-300 ease-in-out shrink-0
        `}>
          <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-white/50">
            <span className="text-sm font-bold text-black">メンバー</span>
            <button 
              onClick={() => setShowSidebarMobile(false)}
              className="sm:hidden p-1 text-gray-400 hover:text-black"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
            <span className="hidden sm:inline text-[10px] text-gray-400 font-medium bg-gray-100 px-1.5 py-0.5 rounded uppercase">
              Class
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            <button
              onClick={() => { setSelectedMemberId(null); setShowSidebarMobile(false); }}
              style={selectedMemberId === null ? { backgroundColor: bubbleColor } : {}}
              className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors border-b border-gray-50 ${
                selectedMemberId === null
                  ? "text-black font-bold"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs ${selectedMemberId === null ? "bg-white/50" : "bg-gray-200"}`}>
                👥
              </div>
              <div className="flex-1 text-left">
                <div className="font-medium">全員</div>
              </div>
            </button>

            {members.map((m) => (
              <button
                key={m.user_id}
                onClick={() => { setSelectedMemberId(m.user_id); setShowSidebarMobile(false); }}
                style={selectedMemberId === m.user_id ? { backgroundColor: bubbleColor } : {}}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors border-b border-gray-50 ${
                  selectedMemberId === m.user_id
                    ? "text-black font-bold"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <Avatar userId={m.user_id} name={m.name} size="sm" />
                <div className="flex-1 text-left min-w-0">
                  <div className="font-medium truncate">{m.name}</div>
                  <div className={`text-[10px] uppercase ${selectedMemberId === m.user_id ? "text-gray-600" : "text-gray-400"}`}>
                    {m.role === "admin" ? "管理者" : "生徒"}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* スマホ用オーバーレイ背景 */}
        {showSidebarMobile && (
          <div 
            className="fixed inset-0 bg-black/20 z-40 sm:hidden"
            onClick={() => setShowSidebarMobile(false)}
          />
        )}

        {/* メインチャット */}
        <div className="flex-1 flex flex-col min-w-0 relative bg-white">

          {/* 送信先バナー（常時表示） */}
          {selectedMemberId ? (
            <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-2.5 bg-orange-50 border-b-2 border-orange-300">
              <div className="flex items-center gap-2">
                <span className="text-lg">🔒</span>
                <div>
                  <p className="text-xs text-orange-600 font-bold uppercase tracking-wide">ダイレクトメッセージ</p>
                  <p className="text-sm font-bold text-orange-800">
                    {members.find(m => m.user_id === selectedMemberId)?.name ?? ""}さんにだけ送信されます
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowSidebarMobile(true)}
                className="sm:hidden text-[10px] text-orange-700 bg-orange-100 border border-orange-300 px-2.5 py-1 rounded-full font-bold"
              >
                切替
              </button>
            </div>
          ) : (
            <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-2.5 border-b border-gray-100" style={{ backgroundColor: bubbleColor + "55" }}>
              <div className="flex items-center gap-2">
                <span className="text-lg">📢</span>
                <div>
                  <p className="text-xs text-gray-500 font-bold uppercase tracking-wide">グループチャット</p>
                  <p className="text-sm font-bold text-gray-800">クラス全員へ送信されます</p>
                </div>
              </div>
              <button
                onClick={() => setShowSidebarMobile(true)}
                className="sm:hidden text-[10px] text-black px-2.5 py-1 rounded-full font-bold shadow-sm border border-black/10"
                style={{ backgroundColor: bubbleColor }}
              >
                切替
              </button>
            </div>
          )}

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

          <div className={selectedMemberId ? "border-t-2 border-orange-300 bg-orange-50" : ""}>
            <MessageInput
              onSend={handleSend}
              placeholder={selectedMemberId ? `🔒 ${members.find(m => m.user_id === selectedMemberId)?.name}さんへ個別送信...` : "📢 クラス全員へ送信..."}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
