"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchProfiles } from "@/lib/profiles";
import Avatar from "./Avatar";

type SharedFile = {
  id: string;
  class_id: string;
  user_id: string;
  name: string;
  file_url: string;
  size: number;
  type: string;
  created_at: string;
};

type FilesProps = {
  classId: string;
  currentUserId: string;
  currentDisplayName: string;
  isAdmin: boolean;
};

export default function Files({
  classId,
  currentUserId,
  currentDisplayName,
  isAdmin,
}: FilesProps) {
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [profiles, setProfiles] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = async () => {
    const { data, error } = await supabase
      .from("shared_files")
      .select("*")
      .eq("class_id", classId)
      .order("created_at", { ascending: false });

    if (error || !data) {
      console.log("ファイル取得エラー:", error);
      setLoading(false);
      return;
    }

    setFiles(data);
    const profileMap = await fetchProfiles(data.map((f) => f.user_id));
    setProfiles(profileMap);
    setLoading(false);
  };

  useEffect(() => {
    fetchFiles();

    const channelId = `files-${classId}-${Date.now()}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "shared_files",
          filter: `class_id=eq.${classId}`,
        },
        async (payload) => {
          const newFile = payload.new as SharedFile;
          setFiles((prev) => [newFile, ...prev]);
          // プロフィール取得
          fetchProfiles([newFile.user_id]).then((newProfiles) => {
            setProfiles((p) => {
              const merged = new Map(p);
              newProfiles.forEach((v, k) => merged.set(k, v));
              return merged;
            });
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "shared_files",
          filter: `class_id=eq.${classId}`,
        },
        (payload) => {
          setFiles((prev) => prev.filter((f) => f.id !== payload.old.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setUploading(true);
    const ext = file.name.split(".").pop();
    const fileName = `files/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("uploads")
      .upload(fileName, file);

    if (uploadError) {
      alert("アップロード失敗: " + uploadError.message);
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(fileName);

    const { error } = await supabase.from("shared_files").insert({
      class_id: classId,
      user_id: currentUserId,
      name: file.name,
      file_url: urlData.publicUrl,
      size: file.size,
      type: file.type || "application/octet-stream",
    });

    if (error) {
      alert("登録失敗: " + error.message);
      setUploading(false);
      return;
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
    setShowForm(false);
    setUploading(false);
    await fetchFiles();

    // 通知を全員に送る
    const { data: members } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("class_id", classId)
      .neq("user_id", currentUserId);

    if (members && members.length > 0) {
      const notifications = members.map((m) => ({
        user_id: m.user_id,
        type: "file",
        content: `${currentDisplayName}さんが新しい資料「${file.name}」を共有しました`,
        link: `/class/${classId}?tab=files`,
      }));
      await supabase.from("notifications").insert(notifications);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("このファイルを削除しますか？")) return;

    const query = supabase.from("shared_files").delete().eq("id", id);
    if (!isAdmin) {
      query.eq("user_id", currentUserId);
    }

    const { error } = await query;
    if (error) {
      alert("削除に失敗しました: " + error.message);
      return;
    }
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const getFileIcon = (type: string) => {
    if (type.includes("pdf")) return "📕";
    if (type.includes("image")) return "🖼️";
    if (type.includes("word") || type.includes("text")) return "📄";
    if (type.includes("excel") || type.includes("spreadsheet")) return "📊";
    if (type.includes("presentation") || type.includes("powerpoint")) return "📉";
    if (type.includes("zip") || type.includes("compressed")) return "📦";
    return "📁";
  };

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-base font-medium text-black">資料</h2>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-black text-white rounded-md hover:bg-gray-800 text-sm font-medium transition-colors"
          >
            {showForm ? "閉じる" : "＋ ファイル共有"}
          </button>
        </div>

        {showForm && (
          <div className="mb-8 bg-gray-50 border border-gray-200 rounded-xl p-6">
            <p className="text-sm text-gray-600 mb-4">
              クラスの全員と共有するファイルをアップロードします
            </p>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleUpload}
              disabled={uploading}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-black file:text-white hover:file:bg-gray-800 disabled:opacity-50 cursor-pointer"
            />
            {uploading && (
              <p className="mt-2 text-sm text-gray-500 animate-pulse">
                アップロード中...
              </p>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-6 h-6 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-20 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
            <p className="text-gray-400 text-sm">共有されている資料はありません</p>
          </div>
        ) : (
          <div className="space-y-3">
            {files.map((f) => {
              const name = profiles.get(f.user_id) || "ユーザー";
              return (
                <div
                  key={f.id}
                  className="group flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-xl hover:border-gray-400 transition-all"
                >
                  <div className="text-3xl w-12 h-12 bg-gray-50 rounded-lg flex items-center justify-center">
                    {getFileIcon(f.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <a
                      href={f.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-sm font-medium text-black hover:underline truncate mb-1"
                    >
                      {f.name}
                    </a>
                    <div className="flex items-center gap-3 text-[11px] text-gray-400">
                      <span>{formatSize(f.size)}</span>
                      <span>•</span>
                      <div className="flex items-center gap-1">
                        <Avatar userId={f.user_id} name={name} size="sm" />
                        <span>{name}</span>
                      </div>
                      <span>•</span>
                      <span>{new Date(f.created_at).toLocaleDateString("ja-JP")}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={f.file_url}
                      download={f.name}
                      className="p-2 text-gray-400 hover:text-black hover:bg-gray-100 rounded-lg transition-colors"
                      title="ダウンロード"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                      </svg>
                    </a>
                    {(f.user_id === currentUserId || isAdmin) && (
                      <button
                        onClick={() => handleDelete(f.id)}
                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="削除"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
