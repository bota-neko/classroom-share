"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { generateJoinCode, fetchProfiles } from "@/lib/profiles";
import Avatar from "./Avatar";
import { useEffect } from "react";

type InvitePanelProps = {
  classId: string;
  joinCode: string | null;
  className: string;
  onUpdate: (data: { name?: string; join_code?: string }) => void;
};

export default function InvitePanel({
  classId,
  joinCode,
  className,
  onUpdate,
}: InvitePanelProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(className);
  const [saving, setSaving] = useState(false);
  const [members, setMembers] = useState<{ id: string; user_id: string; status: string; name: string; role: string }[]>([]);
  const [fetchingMembers, setFetchingMembers] = useState(true);

  const fetchMembers = async () => {
    setFetchingMembers(true);
    const { data, error } = await supabase
      .from("memberships")
      .select("id, user_id, status, role")
      .eq("class_id", classId);

    if (error) {
      console.error("Error fetching members:", error);
      setFetchingMembers(false);
      return;
    }

    const userIds = data.map((m) => m.user_id);
    const profileMap = await fetchProfiles(userIds);

    setMembers(
      data.map((m) => ({
        ...m,
        name: profileMap.get(m.user_id) || "ユーザー",
      }))
    );
    setFetchingMembers(false);
  };

  useEffect(() => {
    fetchMembers();

    const channelId = `members-${classId}-${Date.now()}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        {
          event: "*", // INSERT, UPDATE, DELETE すべて
          schema: "public",
          table: "memberships",
          filter: `class_id=eq.${classId}`,
        },
        () => {
          fetchMembers(); // 変更があったら再取得
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  const handleCopy = async () => {
    if (!joinCode) return;
    try {
      await navigator.clipboard.writeText(joinCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("コピーに失敗しました");
    }
  };

  const handleRegenerateCode = async () => {
    if (!confirm("新しいコードを発行しますか？古いコードは使えなくなります。")) {
      return;
    }
    setSaving(true);
    const newCode = generateJoinCode();
    const { error } = await supabase
      .from("classes")
      .update({ join_code: newCode })
      .eq("id", classId);

    setSaving(false);
    if (error) {
      alert("再生成失敗: " + error.message);
      return;
    }
    onUpdate({ join_code: newCode });
  };

  const handleSaveName = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      alert("クラス名を入力してください");
      return;
    }
    if (trimmed === className) {
      setEditingName(false);
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("classes")
      .update({ name: trimmed })
      .eq("id", classId);

    setSaving(false);
    if (error) {
      alert("更新失敗: " + error.message);
      return;
    }
    onUpdate({ name: trimmed });
    setEditingName(false);
  };

  const handleDelete = async () => {
    const input = prompt(
      `本当に「${className}」を削除しますか？\nメッセージ・作品・メンバーすべて消えます。\n\n確認のためクラス名を入力してください。`
    );
    if (input !== className) {
      if (input !== null) alert("クラス名が一致しません");
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("classes").delete().eq("id", classId);
    setSaving(false);

    if (error) {
      alert("削除失敗: " + error.message);
      return;
    }
    router.push("/dashboard");
  };

  const handleApprove = async (membershipId: string) => {
    const target = members.find((m) => m.id === membershipId);
    if (!target) return;

    const { error } = await supabase
      .from("memberships")
      .update({ status: "approved" })
      .eq("id", membershipId);

    if (error) {
      alert("承認失敗: " + error.message);
      return;
    }

    // 生徒に通知を送る
    await supabase.from("notifications").insert({
      user_id: target.user_id,
      type: "approved",
      content: `「${className}」への参加が承認されました！`,
      link: `/class/${classId}`,
    });

    await fetchMembers();
  };

  const handleReject = async (membershipId: string) => {
    const { error } = await supabase
      .from("memberships")
      .delete()
      .eq("id", membershipId);

    if (error) {
      alert("拒否失敗: " + error.message);
      return;
    }
    await fetchMembers();
  };

  const handleRemoveMember = async (membershipId: string, name: string) => {
    if (!confirm(`本当に「${name}」さんをクラスから外しますか？`)) return;
    const { error } = await supabase
      .from("memberships")
      .delete()
      .eq("id", membershipId);

    if (error) {
      alert("削除失敗: " + error.message);
      return;
    }
    await fetchMembers();
  };

  const pendingRequests = members.filter((m) => m.status === "pending");
  const approvedMembers = members.filter((m) => m.status !== "pending");

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-md mx-auto px-4 sm:px-6 py-8 space-y-4">
        {/* クラス名 */}
        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-sm font-medium text-gray-500 mb-3 uppercase tracking-wide">
            クラス名
          </h2>
          {editingName ? (
            <>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === "Enter") handleSaveName();
                }}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-black focus:border-black"
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setEditingName(false);
                    setNameInput(className);
                  }}
                  className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-md"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSaveName}
                  disabled={saving}
                  className="px-3 py-1.5 text-sm bg-black text-white rounded-md hover:bg-gray-800 disabled:bg-gray-300"
                >
                  保存
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-black">{className}</span>
              <button
                onClick={() => {
                  setEditingName(true);
                  setNameInput(className);
                }}
                className="text-sm text-gray-500 hover:text-black"
              >
                編集
              </button>
            </div>
          )}
        </section>

        {/* 参加コード */}
        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-sm font-medium text-gray-500 mb-1 uppercase tracking-wide">
            参加コード
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            生徒に共有してクラスに招待しよう
          </p>

          {joinCode ? (
            <>
              <div className="bg-blue-50 rounded-xl py-6 text-center mb-3">
                <div className="text-3xl font-mono font-bold text-black tracking-[0.3em]">
                  {joinCode}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCopy}
                  className="flex-1 py-2 bg-black text-white rounded-lg hover:bg-gray-800 font-medium text-sm"
                >
                  {copied ? "✓ コピー済み" : "コピー"}
                </button>
                <button
                  onClick={handleRegenerateCode}
                  disabled={saving}
                  className="flex-1 py-2 bg-white border border-gray-300 text-black rounded-lg hover:bg-gray-50 font-medium text-sm disabled:opacity-50"
                >
                  再発行
                </button>
              </div>
            </>
          ) : (
            <button
              onClick={handleRegenerateCode}
              disabled={saving}
              className="w-full py-2 bg-black text-white rounded-lg hover:bg-gray-800 font-medium text-sm"
            >
              参加コードを発行
            </button>
          )}
        </section>

        {/* 参加リクエスト */}
        {pendingRequests.length > 0 && (
          <section className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="text-sm font-medium text-amber-600 mb-4 uppercase tracking-wide flex items-center gap-2">
              <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
              参加リクエスト ({pendingRequests.length})
            </h2>
            <div className="space-y-4">
              {pendingRequests.map((req) => (
                <div key={req.id} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar userId={req.user_id} name={req.name} size="sm" />
                    <span className="text-sm font-medium text-black truncate">
                      {req.name}
                    </span>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleApprove(req.id)}
                      className="px-3 py-1 bg-black text-white rounded-md text-xs font-medium hover:bg-gray-800"
                    >
                      承認
                    </button>
                    <button
                      onClick={() => handleReject(req.id)}
                      className="px-3 py-1 bg-gray-100 text-gray-700 rounded-md text-xs font-medium hover:bg-gray-200"
                    >
                      拒否
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* メンバー一覧 */}
        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-sm font-medium text-gray-500 mb-4 uppercase tracking-wide">
            メンバー ({approvedMembers.length})
          </h2>
          {fetchingMembers ? (
            <div className="py-4 text-center text-xs text-gray-400">読み込み中...</div>
          ) : (
            <div className="space-y-4">
              {approvedMembers.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar userId={m.user_id} name={m.name} size="sm" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-black truncate">
                        {m.name}
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {m.role === "admin" ? "管理者" : "生徒"}
                      </div>
                    </div>
                  </div>
                  {m.role !== "admin" && (
                    <button
                      onClick={() => handleRemoveMember(m.id, m.name)}
                      className="text-xs text-gray-400 hover:text-rose-600 transition-colors"
                    >
                      外す
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 削除 */}
        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-sm font-medium text-gray-500 mb-1 uppercase tracking-wide">
            危険な操作
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            メッセージ・作品・メンバーすべてが完全に削除されます
          </p>
          <button
            onClick={handleDelete}
            disabled={saving}
            className="w-full py-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg hover:bg-rose-100 font-medium text-sm disabled:opacity-50"
          >
            このクラスを削除
          </button>
        </section>
      </div>
    </div>
  );
}
