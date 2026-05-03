"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getClassTheme } from "@/lib/profiles";
import Chat from "@/components/Chat";
import Works from "@/components/Works";
import NotificationBell from "@/components/NotificationBell";
import InvitePanel from "@/components/InvitePanel";
import Files from "@/components/Files";
import Board from "@/components/Board";

type Tab = "chat" | "board" | "works" | "files" | "invite";

export default function ClassPage() {
  const params = useParams();
  const router = useRouter();
  const classId = params.id as string;

  const [className, setClassName] = useState("");
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [meetingUrl, setMeetingUrl] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("chat");

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

      const { data: membership } = await supabase
        .from("memberships")
        .select("role, status")
        .eq("user_id", uid)
        .eq("class_id", classId)
        .maybeSingle();

      if (!membership) {
        alert("このクラスにアクセスする権限がありません");
        router.replace("/dashboard");
        return;
      }
      setRole(membership.role);
      setStatus(membership.status);

      const { data: classData, error } = await supabase
        .from("classes")
        .select("name, join_code, meeting_url")
        .eq("id", classId)
        .single();

      if (error || !classData) {
        router.replace("/dashboard");
        return;
      }
      setClassName(classData.name);
      setJoinCode(classData.join_code);
      setMeetingUrl(classData.meeting_url ?? null);
      setLoading(false);
    };

    init();

    const channelId = `class-page-${classId}-${Date.now()}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "memberships",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.new && (payload.new as any).status) {
            setStatus((payload.new as any).status);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "classes",
          filter: `id=eq.${classId}`,
        },
        (payload) => {
          const updated = payload.new as any;
          if (updated.name) setClassName(updated.name);
          if ("meeting_url" in updated) setMeetingUrl(updated.meeting_url ?? null);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [classId, router, userId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
      </div>
    );
  }

  const isAdmin = role === "admin";
  const theme = getClassTheme(classId);

  if (status === "pending") {
    return (
      <div className={`flex flex-col items-center justify-center min-h-screen ${theme.bg}`}>
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">⏳</span>
          </div>
          <h1 className="text-xl font-bold text-black mb-2">承認待ちです</h1>
          <p className="text-sm text-gray-500 mb-6">
            先生が参加を承認するまで、クラスの内容を見ることはできません。
          </p>
          <button
            onClick={() => router.push("/dashboard")}
            className="w-full py-2 bg-black text-white rounded-lg hover:bg-gray-800 text-sm font-medium"
          >
            ダッシュボードに戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* パステルヘッダー */}
      <header className={`${theme.bg} shrink-0 border-b border-gray-200`}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <button
            onClick={() => router.push("/dashboard")}
            className={`p-1.5 hover:bg-white/50 rounded-lg transition-colors ${theme.text}`}
            aria-label="戻る"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-5 h-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 19.5 8.25 12l7.5-7.5"
              />
            </svg>
          </button>
          <h1 className={`text-lg font-semibold truncate flex-1 ${theme.text}`}>
            {className}
          </h1>
          {isAdmin && (
            <span className="text-[10px] bg-white/70 text-gray-700 px-2 py-0.5 rounded-full font-medium uppercase tracking-wider shrink-0">
              管理者
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {meetingUrl && (
              <a
                href={meetingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-black text-white text-xs font-medium rounded-lg hover:bg-gray-800 transition-colors shrink-0"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
                会議に参加
              </a>
            )}
            <NotificationBell userId={userId} />
          </div>
        </div>
      </header>

      {/* タブ */}
      <div className="bg-white border-b border-gray-200 shrink-0 overflow-x-auto no-scrollbar">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex min-w-max">
          <TabButton
            active={tab === "chat"}
            onClick={() => setTab("chat")}
            label="チャット"
          />
          <TabButton
            active={tab === "board"}
            onClick={() => setTab("board")}
            label="質問・掲示板"
          />
          <TabButton
            active={tab === "works"}
            onClick={() => setTab("works")}
            label="作品"
          />
          <TabButton
            active={tab === "files"}
            onClick={() => setTab("files")}
            label="資料"
          />
          {isAdmin && (
            <TabButton
              active={tab === "invite"}
              onClick={() => setTab("invite")}
              label="管理"
            />
          )}
        </div>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 overflow-hidden">
        {tab === "chat" && (
          <Chat
            classId={classId}
            currentUserId={userId}
            currentDisplayName={displayName}
            bubbleColor={theme.hex}
          />
        )}
        {tab === "board" && (
          <Board
            classId={classId}
            currentUserId={userId}
            currentDisplayName={displayName}
            isAdmin={isAdmin}
          />
        )}
        {tab === "works" && (
          <Works
            classId={classId}
            currentUserId={userId}
            currentDisplayName={displayName}
            isAdmin={isAdmin}
          />
        )}
        {tab === "files" && (
          <Files
            classId={classId}
            currentUserId={userId}
            currentDisplayName={displayName}
            isAdmin={isAdmin}
          />
        )}
        {tab === "invite" && isAdmin && (
          <InvitePanel
            classId={classId}
            joinCode={joinCode}
            className={className}
            meetingUrl={meetingUrl}
            onUpdate={(data) => {
              if (data.name !== undefined) setClassName(data.name);
              if (data.join_code !== undefined) setJoinCode(data.join_code);
              if ("meeting_url" in data) setMeetingUrl(data.meeting_url ?? null);
            }}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        active
          ? "border-black text-black"
          : "border-transparent text-gray-500 hover:text-black"
      }`}
    >
      {label}
    </button>
  );
}
