"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { generateJoinCode, getClassTheme } from "@/lib/profiles";
import Avatar from "@/components/Avatar";
import NotificationBell from "@/components/NotificationBell";

type ClassInfo = {
  id: string;
  name: string;
  role: string;
  status: string;
  join_code: string | null;
};

export default function DashboardPage() {
  const router = useRouter();
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [newClassName, setNewClassName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [editName, setEditName] = useState("");

  const fetchClasses = async (uid: string) => {
    const { data: memberships } = await supabase
      .from("memberships")
      .select("class_id, role, status")
      .eq("user_id", uid);

    if (!memberships || memberships.length === 0) {
      setClasses([]);
      return;
    }

    const classIds = memberships.map((m) => m.class_id);
    const { data: classesData } = await supabase
      .from("classes")
      .select("id, name, join_code")
      .in("id", classIds);

    if (!classesData) return;

    const list: ClassInfo[] = classesData.map((cls) => {
      const m = memberships.find((mem) => mem.class_id === cls.id);
      return {
        id: cls.id,
        name: cls.name,
        role: m?.role || "student",
        status: m?.status || "pending",
        join_code: cls.join_code,
      };
    });
    setClasses(list);
  };

  useEffect(() => {
    const init = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        router.replace("/login");
        return;
      }
      const uid = sessionData.session.user.id;
      setUserId(uid);

      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", uid)
        .single();

      setDisplayName(profile?.display_name || "ユーザー");
      await fetchClasses(uid);
      setLoading(false);

      // メンバーシップの変化を購読
      const channelId = `dashboard-${uid}-${Date.now()}`;
      const channel = supabase
        .channel(channelId)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "memberships",
            filter: `user_id=eq.${uid}`,
          },
          () => {
            fetchClasses(uid);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    };
    init();
  }, [router]);

  const handleCreateClass = async () => {
    if (!newClassName.trim()) return;
    const code = generateJoinCode();
    const { data: newClass, error } = await supabase
      .from("classes")
      .insert({ name: newClassName.trim(), created_by: userId, join_code: code })
      .select()
      .single();

    if (error || !newClass) {
      alert("作成失敗: " + error?.message);
      return;
    }

    await supabase.from("memberships").insert({
      user_id: userId,
      class_id: newClass.id,
      role: "admin",
      status: "approved",
    });

    setNewClassName("");
    setShowCreate(false);
    await fetchClasses(userId);
  };

  const handleJoinClass = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    const { data: cls, error } = await supabase
      .from("classes")
      .select("id, name, created_by")
      .eq("join_code", code)
      .single();

    if (error || !cls) {
      alert("無効な参加コードです");
      return;
    }

    const { data: existing } = await supabase
      .from("memberships")
      .select("id")
      .eq("user_id", userId)
      .eq("class_id", cls.id)
      .maybeSingle();

    if (existing) {
      alert("既に参加済みです");
      setShowJoin(false);
      return;
    }

    const { error: memError } = await supabase.from("memberships").insert({
      user_id: userId,
      class_id: cls.id,
      role: "student",
      status: "pending",
    });

    if (memError) {
      alert("参加失敗: " + memError.message);
      return;
    }

    // 参加通知を管理者に送る
    await supabase.from("notifications").insert({
      user_id: cls.created_by,
      type: "join_request",
      content: `${displayName || "新メンバー"}が「${cls.name}」への参加をリクエストしました`,
      link: `/class/${cls.id}?tab=invite`,
    });

    setJoinCode("");
    setShowJoin(false);
    await fetchClasses(userId);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const handleUpdateName = async () => {
    const trimmed = editName.trim();
    if (!trimmed) {
      alert("名前を入力してください");
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: userId, display_name: trimmed }, { onConflict: "id" });

    if (error) {
      alert("更新失敗: " + error.message);
      return;
    }
    setDisplayName(trimmed);
    setShowProfile(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center text-white font-bold text-sm">
              C
            </div>
            <h1 className="text-base font-medium text-black">Classroom</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowJoin(true)}
              className="hidden sm:inline-flex px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
            >
              参加
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
            >
              ＋ 作成
            </button>
            <NotificationBell userId={userId} />
            <div className="relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="flex items-center"
              >
                <Avatar userId={userId} name={displayName} size="md" />
              </button>
              {showMenu && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowMenu(false)}
                  />
                  <div className="absolute right-0 top-12 bg-white border border-gray-200 rounded-lg shadow-lg w-56 z-20 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100">
                      <div className="font-medium text-sm text-black">
                        {displayName}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setEditName(displayName);
                        setShowProfile(true);
                        setShowMenu(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      表示名を変更
                    </button>
                    <button
                      onClick={() => {
                        setShowJoin(true);
                        setShowMenu(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 sm:hidden"
                    >
                      クラスに参加
                    </button>
                    <button
                      onClick={() => {
                        setShowCreate(true);
                        setShowMenu(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 sm:hidden"
                    >
                      クラスを作成
                    </button>
                    <div className="border-t border-gray-100" />
                    <button
                      onClick={handleLogout}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      ログアウト
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* メイン */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {classes.length === 0 ? (
          <div className="text-center py-20">
            <h2 className="text-lg font-medium text-black mb-2">
              クラスがありません
            </h2>
            <p className="text-gray-500 text-sm mb-6">
              新しいクラスを作るか、参加コードで参加しましょう
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => setShowCreate(true)}
                className="px-4 py-2 bg-black text-white rounded-md hover:bg-gray-800 text-sm font-medium"
              >
                クラスを作成
              </button>
              <button
                onClick={() => setShowJoin(true)}
                className="px-4 py-2 bg-white border border-gray-300 text-black rounded-md hover:bg-gray-50 text-sm font-medium"
              >
                参加コードで参加
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {classes.map((cls) => {
              const theme = getClassTheme(cls.id);
              return (
                <button
                  key={cls.id}
                  onClick={() => router.push(`/class/${cls.id}`)}
                  className="group bg-white border border-gray-200 rounded-md overflow-hidden text-left hover:border-gray-400 transition-colors"
                >
                  {/* パステルカラーヘッダー */}
                  <div
                    className={`${theme.bg} h-24 px-5 py-4 relative flex flex-col justify-end`}
                  >
                    <h3
                      className={`${theme.text} text-xl font-semibold line-clamp-2`}
                    >
                      {cls.name}
                    </h3>
                    {cls.role === "admin" && (
                      <div className="absolute top-3 right-3">
                        <span className="text-[10px] bg-white/70 text-gray-700 px-2 py-0.5 rounded-full font-medium uppercase tracking-wider">
                          管理者
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="px-5 py-3 flex items-center justify-between border-t border-gray-100">
                    <span className="text-xs text-gray-500">
                      {cls.status === "pending" ? (
                        <span className="text-amber-600 font-medium">承認待ち</span>
                      ) : (
                        cls.role === "admin" ? "管理者" : "メンバー"
                      )}
                    </span>
                    {cls.status === "approved" && (
                      <span className="text-gray-300 group-hover:text-black transition-colors text-sm">
                        →
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>

      {/* 表示名編集モーダル */}
      {showProfile && (
        <Modal onClose={() => setShowProfile(false)} title="表示名を変更">
          <p className="text-sm text-gray-500 mb-3">
            チャットや作品で表示される名前です
          </p>
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") handleUpdateName();
            }}
            placeholder="表示名"
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-black focus:border-black"
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowProfile(false)}
              className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md"
            >
              キャンセル
            </button>
            <button
              onClick={handleUpdateName}
              className="px-4 py-2 text-sm bg-black text-white rounded-md hover:bg-gray-800 font-medium"
            >
              保存
            </button>
          </div>
        </Modal>
      )}

      {/* 作成モーダル */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)} title="クラスを作成">
          <input
            type="text"
            value={newClassName}
            onChange={(e) => setNewClassName(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") handleCreateClass();
            }}
            placeholder="クラス名（例: 3年A組）"
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-black focus:border-black"
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                setShowCreate(false);
                setNewClassName("");
              }}
              className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md"
            >
              キャンセル
            </button>
            <button
              onClick={handleCreateClass}
              className="px-4 py-2 text-sm bg-black text-white rounded-md hover:bg-gray-800 font-medium"
            >
              作成
            </button>
          </div>
        </Modal>
      )}

      {/* 参加モーダル */}
      {showJoin && (
        <Modal onClose={() => setShowJoin(false)} title="クラスに参加">
          <p className="text-sm text-gray-500 mb-3">
            先生から教えてもらった参加コードを入力してください
          </p>
          <input
            type="text"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") handleJoinClass();
            }}
            placeholder="例: ABC123"
            maxLength={6}
            className="w-full px-3 py-3 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-black focus:border-black uppercase tracking-[0.3em] text-center text-xl font-mono"
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                setShowJoin(false);
                setJoinCode("");
              }}
              className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md"
            >
              キャンセル
            </button>
            <button
              onClick={handleJoinClass}
              className="px-4 py-2 text-sm bg-black text-white rounded-md hover:bg-gray-800 font-medium"
            >
              参加
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl border border-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-medium mb-4 text-black">{title}</h2>
        {children}
      </div>
    </div>
  );
}
