"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchProfiles } from "@/lib/profiles";
import Avatar from "./Avatar";

type Work = {
  id: string;
  class_id: string;
  user_id: string;
  title: string;
  image_url: string | null;
  created_at: string;
};

type WorksProps = {
  classId: string;
  currentUserId: string;
  currentDisplayName: string;
  isAdmin: boolean;
};

export default function Works({
  classId,
  currentUserId,
  currentDisplayName,
  isAdmin,
}: WorksProps) {
  const [works, setWorks] = useState<Work[]>([]);
  const [profiles, setProfiles] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedWork, setSelectedWork] = useState<Work | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchWorks = async () => {
    const { data, error } = await supabase
      .from("works")
      .select("*")
      .eq("class_id", classId)
      .order("created_at", { ascending: false });

    if (error || !data) {
      console.log("作品取得エラー:", error);
      setLoading(false);
      return;
    }

    setWorks(data);
    const profileMap = await fetchProfiles(data.map((w) => w.user_id));
    setProfiles(profileMap);
    setLoading(false);
  };

  useEffect(() => {
    fetchWorks();

    const channelId = `works-${classId}-${Date.now()}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "works",
          filter: `class_id=eq.${classId}`,
        },
        async (payload) => {
          const newWork = payload.new as Work;
          setWorks((prev) => [newWork, ...prev]);
          // プロフィールがなければ取得
          setProfiles((prev) => {
            if (!prev.has(newWork.user_id)) {
              fetchProfiles([newWork.user_id]).then((newProfiles) => {
                setProfiles((p) => {
                  const merged = new Map(p);
                  newProfiles.forEach((v, k) => merged.set(k, v));
                  return merged;
                });
              });
            }
            return prev;
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "works",
          filter: `class_id=eq.${classId}`,
        },
        (payload) => {
          const updated = payload.new as Work;
          setWorks((prev) =>
            prev.map((w) => (w.id === updated.id ? updated : w))
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "works",
          filter: `class_id=eq.${classId}`,
        },
        (payload) => {
          setWorks((prev) => prev.filter((w) => w.id !== payload.old.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      alert("タイトルを入力してください");
      return;
    }

    setUploading(true);
    let imageUrl: string | null = null;

    const file = fileInputRef.current?.files?.[0];
    if (file) {
      const ext = file.name.split(".").pop();
      const fileName = `works/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("uploads")
        .upload(fileName, file);

      if (uploadError) {
        alert("画像アップロード失敗: " + uploadError.message);
        setUploading(false);
        return;
      }
      const { data } = supabase.storage.from("uploads").getPublicUrl(fileName);
      imageUrl = data.publicUrl;
    }

    const { error } = await supabase.from("works").insert({
      class_id: classId,
      user_id: currentUserId,
      title: title.trim(),
      image_url: imageUrl,
    });

    if (error) {
      alert("投稿失敗: " + error.message);
      setUploading(false);
      return;
    }

    setTitle("");
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setShowForm(false);
    setUploading(false);
    await fetchWorks();

    // 通知を全員に送る
    const { data: members } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("class_id", classId)
      .neq("user_id", currentUserId);

    if (members && members.length > 0) {
      const notifications = members.map((m) => ({
        user_id: m.user_id,
        type: "work",
        content: `${currentDisplayName}さんが新しい作品「${title.trim()}」を投稿しました`,
        link: `/class/${classId}?tab=works`,
      }));
      await supabase.from("notifications").insert(notifications);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("この作品を削除しますか？")) return;

    const query = supabase.from("works").delete().eq("id", id);

    // 管理者でない場合は自分の作品のみ削除可能にする（DBポリシーでも制限されるべき）
    if (!isAdmin) {
      query.eq("user_id", currentUserId);
    }

    const { error } = await query;
    if (error) {
      alert("削除に失敗しました: " + error.message);
      return;
    }
    setWorks((prev) => prev.filter((w) => w.id !== id));
  };

  const handleUpdate = async () => {
    if (!selectedWork || !editTitle.trim()) return;

    const { error } = await supabase
      .from("works")
      .update({ title: editTitle.trim() })
      .eq("id", selectedWork.id);

    if (error) {
      alert("更新に失敗しました: " + error.message);
      return;
    }

    setWorks((prev) =>
      prev.map((w) =>
        w.id === selectedWork.id ? { ...w, title: editTitle.trim() } : w
      )
    );
    setSelectedWork({ ...selectedWork, title: editTitle.trim() });
    setIsEditing(false);
  };

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-base font-medium text-black">作品</h2>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-black text-white rounded-md hover:bg-gray-800 text-sm font-medium"
          >
            {showForm ? "閉じる" : "＋ 投稿する"}
          </button>
        </div>

        {showForm && (
          <div className="mb-6 bg-white border border-gray-200 rounded-xl p-5">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="作品タイトル"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-black focus:border-black"
            />

            <label className="block mb-3">
              <span className="text-sm text-gray-600 block mb-1">
                画像（任意）
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="block text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
              />
            </label>

            {previewUrl && (
              <img
                src={previewUrl}
                alt="プレビュー"
                className="max-h-48 rounded-lg mb-3 border border-gray-200"
              />
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowForm(false);
                  setTitle("");
                  setPreviewUrl(null);
                }}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md"
              >
                キャンセル
              </button>
              <button
                onClick={handleSubmit}
                disabled={uploading}
                className="px-4 py-2 text-sm bg-black text-white rounded-md hover:bg-gray-800 disabled:bg-gray-300 font-medium"
              >
                {uploading ? "投稿中..." : "投稿"}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-6 h-6 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
          </div>
        ) : works.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-500 text-sm">まだ作品がありません</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1 sm:gap-4">
            {works.map((w) => {
              const name = profiles.get(w.user_id) || "ユーザー";
              return (
                <button
                  key={w.id}
                  onClick={() => setSelectedWork(w)}
                  className="aspect-square bg-gray-50 border border-gray-100 overflow-hidden hover:opacity-90 transition-opacity group relative"
                >
                  {w.image_url ? (
                    <img
                      src={w.image_url}
                      alt={w.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300 text-2xl">
                      📄
                    </div>
                  )}
                  {/* ホバー時にタイトルを薄く表示 */}
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-2">
                    <p className="text-white text-[10px] sm:text-xs font-medium line-clamp-2 text-center">
                      {w.title}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 拡大表示（Lightbox） */}
      {selectedWork && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 sm:p-8"
          onClick={() => setSelectedWork(null)}
        >
          <button
            onClick={() => setSelectedWork(null)}
            className="absolute top-4 right-4 text-white hover:text-gray-300 transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-8 h-8"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>

          <div
            className="bg-white rounded-xl overflow-hidden max-w-4xl w-full max-h-full flex flex-col sm:flex-row"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 画像エリア */}
            <div className="flex-1 bg-gray-50 flex items-center justify-center min-h-[300px]">
              {selectedWork.image_url ? (
                <img
                  src={selectedWork.image_url}
                  alt={selectedWork.title}
                  className="max-w-full max-h-[70vh] object-contain"
                />
              ) : (
                <div className="text-gray-300 text-6xl">📄</div>
              )}
            </div>

            {/* 詳細エリア */}
            <div className="w-full sm:w-80 p-6 flex flex-col">
              <div className="flex items-center gap-3 mb-6">
                <Avatar
                  userId={selectedWork.user_id}
                  name={profiles.get(selectedWork.user_id) || "ユーザー"}
                  size="md"
                />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-black truncate">
                    {profiles.get(selectedWork.user_id) || "ユーザー"}
                  </div>
                  <div className="text-xs text-gray-400">
                    {new Date(selectedWork.created_at).toLocaleDateString(
                      "ja-JP"
                    )}
                  </div>
                </div>
              </div>

              {isEditing ? (
                <div className="mb-4">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black mb-2"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleUpdate}
                      className="flex-1 py-2 bg-black text-white rounded-md text-sm font-medium"
                    >
                      保存
                    </button>
                    <button
                      onClick={() => setIsEditing(false)}
                      className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-md text-sm font-medium"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              ) : (
                <h3 className="text-lg font-bold text-black mb-4">
                  {selectedWork.title}
                </h3>
              )}

              <div className="mt-auto pt-6 flex flex-col gap-2 border-t border-gray-100">
                {(selectedWork.user_id === currentUserId || isAdmin) && !isEditing && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setEditTitle(selectedWork.title);
                        setIsEditing(true);
                      }}
                      className="flex-1 py-2 border border-gray-300 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-50"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => {
                        handleDelete(selectedWork.id);
                        setSelectedWork(null);
                      }}
                      className="flex-1 py-2 border border-red-200 text-red-500 rounded-md text-sm font-medium hover:bg-red-50"
                    >
                      削除
                    </button>
                  </div>
                )}
                <button
                  onClick={() => {
                    setSelectedWork(null);
                    setIsEditing(false);
                  }}
                  className="w-full py-2 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
