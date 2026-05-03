"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchProfiles } from "@/lib/profiles";
import Avatar from "./Avatar";

type Post = {
  id: string;
  class_id: string;
  user_id: string;
  title: string;
  content: string;
  created_at: string;
  reply_count: number;
};

type Reply = {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
};

type BoardProps = {
  classId: string;
  currentUserId: string;
  currentDisplayName: string;
  isAdmin: boolean;
};

export default function Board({ classId, currentUserId, currentDisplayName, isAdmin }: BoardProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [profiles, setProfiles] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [showNewPost, setShowNewPost] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [replyContent, setReplyContent] = useState("");
  const [replyProfiles, setReplyProfiles] = useState<Map<string, string>>(new Map());
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchPosts = async () => {
    const { data, error } = await supabase
      .from("board_posts")
      .select("*, board_replies(count)")
      .eq("class_id", classId)
      .order("created_at", { ascending: false });

    if (error || !data) {
      setLoading(false);
      return;
    }

    const postsWithCount: Post[] = data.map((p) => ({
      ...p,
      reply_count: (p.board_replies as { count: number }[])?.[0]?.count ?? 0,
    }));

    setPosts(postsWithCount);
    const profileMap = await fetchProfiles(data.map((p) => p.user_id));
    profileMap.set(currentUserId, currentDisplayName);
    setProfiles(profileMap);
    setLoading(false);
  };

  useEffect(() => {
    fetchPosts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  useEffect(() => {
    if (!selectedPost) return;

    setRepliesLoading(true);
    supabase
      .from("board_replies")
      .select("*")
      .eq("post_id", selectedPost.id)
      .order("created_at", { ascending: true })
      .then(async ({ data, error }) => {
        if (!error && data) {
          setReplies(data);
          const profileMap = await fetchProfiles(data.map((r) => r.user_id));
          profileMap.set(currentUserId, currentDisplayName);
          setReplyProfiles(profileMap);
        }
        setRepliesLoading(false);
      });

    const channel = supabase
      .channel(`board-replies-${selectedPost.id}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "board_replies",
        filter: `post_id=eq.${selectedPost.id}`,
      }, async (payload) => {
        const newReply = payload.new as Reply;
        setReplies((prev) => {
          if (prev.some((r) => r.id === newReply.id)) return prev;
          return [...prev, newReply];
        });
        setReplyProfiles((prev) => {
          if (prev.has(newReply.user_id)) return prev;
          fetchProfiles([newReply.user_id]).then((np) => {
            setReplyProfiles((p) => {
              const merged = new Map(p);
              np.forEach((v, k) => merged.set(k, v));
              return merged;
            });
          });
          return prev;
        });
        setPosts((prev) =>
          prev.map((p) =>
            p.id === newReply.post_id ? { ...p, reply_count: p.reply_count + 1 } : p
          )
        );
      })
      .on("postgres_changes", {
        event: "DELETE",
        schema: "public",
        table: "board_replies",
        filter: `post_id=eq.${selectedPost.id}`,
      }, (payload) => {
        setReplies((prev) => prev.filter((r) => r.id !== payload.old.id));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPost?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [replies]);

  const handleCreatePost = async () => {
    if (!newTitle.trim() || !newContent.trim()) {
      alert("タイトルと内容を入力してください");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("board_posts").insert({
      class_id: classId,
      user_id: currentUserId,
      title: newTitle.trim(),
      content: newContent.trim(),
    });
    setSubmitting(false);
    if (error) {
      alert("投稿に失敗しました: " + error.message);
      return;
    }
    setNewTitle("");
    setNewContent("");
    setShowNewPost(false);
    await fetchPosts();
  };

  const handleDeletePost = async (postId: string) => {
    if (!confirm("この投稿を削除しますか？返信もすべて削除されます。")) return;
    const query = supabase.from("board_posts").delete().eq("id", postId);
    if (!isAdmin) query.eq("user_id", currentUserId);
    const { error } = await query;
    if (error) return;
    setPosts((prev) => prev.filter((p) => p.id !== postId));
    if (selectedPost?.id === postId) setSelectedPost(null);
  };

  const handleSendReply = async () => {
    if (!replyContent.trim() || !selectedPost) return;
    const { error } = await supabase.from("board_replies").insert({
      post_id: selectedPost.id,
      user_id: currentUserId,
      content: replyContent.trim(),
    });
    if (error) {
      alert("返信に失敗しました: " + error.message);
      return;
    }
    setReplyContent("");
  };

  const handleDeleteReply = async (replyId: string) => {
    const query = supabase.from("board_replies").delete().eq("id", replyId);
    if (!isAdmin) query.eq("user_id", currentUserId);
    const { error } = await query;
    if (error) return;
    setReplies((prev) => prev.filter((r) => r.id !== replyId));
    if (selectedPost) {
      setPosts((prev) =>
        prev.map((p) =>
          p.id === selectedPost.id ? { ...p, reply_count: Math.max(0, p.reply_count - 1) } : p
        )
      );
    }
  };

  if (selectedPost) {
    const authorName = profiles.get(selectedPost.user_id) || "ユーザー";
    return (
      <div className="flex flex-col h-full bg-white">
        <div className="border-b border-gray-200 shrink-0">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
            <button
              onClick={() => setSelectedPost(null)}
              className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-600"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
            </button>
            <span className="text-sm font-medium text-black truncate flex-1">{selectedPost.title}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
            {/* 元投稿 */}
            <div className="mb-6 pb-6 border-b border-gray-100">
              <div className="flex items-start gap-3">
                <Avatar userId={selectedPost.user_id} name={authorName} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-sm font-medium text-black">{authorName}</span>
                    <span className="text-xs text-gray-400">
                      {new Date(selectedPost.created_at).toLocaleDateString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {(selectedPost.user_id === currentUserId || isAdmin) && (
                      <button
                        onClick={() => handleDeletePost(selectedPost.id)}
                        className="text-xs text-gray-400 hover:text-red-500 ml-auto"
                      >
                        削除
                      </button>
                    )}
                  </div>
                  <h2 className="font-semibold text-black mb-2">{selectedPost.title}</h2>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{selectedPost.content}</p>
                </div>
              </div>
            </div>

            {/* 返信一覧 */}
            {repliesLoading ? (
              <div className="flex justify-center py-8">
                <div className="w-5 h-5 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
              </div>
            ) : replies.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-8">まだ返信がありません</p>
            ) : (
              <div className="space-y-4">
                {replies.map((reply) => {
                  const name = replyProfiles.get(reply.user_id) || "ユーザー";
                  return (
                    <div key={reply.id} className="flex items-start gap-3">
                      <Avatar userId={reply.user_id} name={name} size="sm" />
                      <div className="flex-1 min-w-0 bg-gray-50 rounded-xl px-4 py-3">
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className="text-xs font-medium text-black">{name}</span>
                          <span className="text-[10px] text-gray-400">
                            {new Date(reply.created_at).toLocaleDateString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </span>
                          {(reply.user_id === currentUserId || isAdmin) && (
                            <button
                              onClick={() => handleDeleteReply(reply.id)}
                              className="text-[10px] text-gray-400 hover:text-red-500 ml-auto"
                            >
                              削除
                            </button>
                          )}
                        </div>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{reply.content}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* 返信入力 */}
        <div className="border-t border-gray-200 bg-white shrink-0">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex gap-2">
            <input
              type="text"
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendReply();
                }
              }}
              placeholder="返信を入力..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-black"
            />
            <button
              onClick={handleSendReply}
              disabled={!replyContent.trim()}
              className="px-4 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:bg-gray-300"
            >
              返信
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-base font-medium text-black">掲示板</h2>
          <button
            onClick={() => setShowNewPost(!showNewPost)}
            className="px-4 py-2 bg-black text-white rounded-md hover:bg-gray-800 text-sm font-medium"
          >
            {showNewPost ? "閉じる" : "＋ 質問する"}
          </button>
        </div>

        {showNewPost && (
          <div className="mb-6 bg-white border border-gray-200 rounded-xl p-5">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="タイトル（例：〇〇について教えてください）"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg mb-3 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-black"
            />
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="詳細を入力..."
              rows={4}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg mb-3 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-black resize-none"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowNewPost(false); setNewTitle(""); setNewContent(""); }}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md"
              >
                キャンセル
              </button>
              <button
                onClick={handleCreatePost}
                disabled={submitting}
                className="px-4 py-2 text-sm bg-black text-white rounded-md hover:bg-gray-800 disabled:bg-gray-300 font-medium"
              >
                {submitting ? "投稿中..." : "投稿"}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-6 h-6 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-500 text-sm">まだ投稿がありません</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {posts.map((post) => {
              const name = profiles.get(post.user_id) || "ユーザー";
              return (
                <button
                  key={post.id}
                  onClick={() => setSelectedPost(post)}
                  className="w-full text-left py-4 hover:bg-gray-50 transition-colors group px-2 rounded-lg"
                >
                  <div className="flex items-start gap-3">
                    <Avatar userId={post.user_id} name={name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-gray-500">{name}</span>
                        <span className="text-xs text-gray-400">
                          {new Date(post.created_at).toLocaleDateString("ja-JP", { month: "short", day: "numeric" })}
                        </span>
                      </div>
                      <h3 className="text-sm font-medium text-black truncate group-hover:underline">{post.title}</h3>
                      <p className="text-xs text-gray-500 truncate mt-0.5">{post.content}</p>
                    </div>
                    <div className="shrink-0 flex items-center gap-1 text-xs text-gray-400 pt-4">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.74v6.018Z" />
                      </svg>
                      <span>{post.reply_count}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
