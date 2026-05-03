import { supabase } from "./supabase";

// 複数のuser_idからdisplay_nameを取得
export async function fetchProfiles(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, string>();
  const uniqueIds = Array.from(new Set(userIds));

  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", uniqueIds);

  if (error || !data) return new Map<string, string>();

  const map = new Map<string, string>();
  data.forEach((p: { id: string; display_name: string }) => {
    map.set(p.id, p.display_name);
  });
  return map;
}

// 6文字の参加コード
export function generateJoinCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// クラスIDからパステルテーマを生成
const CLASS_COLORS = [
  { bg: "bg-blue-100", text: "text-blue-900", accent: "bg-blue-200", hex: "#dbeafe" },
  { bg: "bg-emerald-100", text: "text-emerald-900", accent: "bg-emerald-200", hex: "#d1fae5" },
  { bg: "bg-violet-100", text: "text-violet-900", accent: "bg-violet-200", hex: "#ede9fe" },
  { bg: "bg-rose-100", text: "text-rose-900", accent: "bg-rose-200", hex: "#ffe4e6" },
  { bg: "bg-amber-100", text: "text-amber-900", accent: "bg-amber-200", hex: "#fef3c7" },
  { bg: "bg-teal-100", text: "text-teal-900", accent: "bg-teal-200", hex: "#ccfbf1" },
  { bg: "bg-indigo-100", text: "text-indigo-900", accent: "bg-indigo-200", hex: "#e0e7ff" },
  { bg: "bg-pink-100", text: "text-pink-900", accent: "bg-pink-200", hex: "#fce7f3" },
];

export function getClassTheme(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return CLASS_COLORS[hash % CLASS_COLORS.length];
}

// アバター用パステル
const AVATAR_COLORS = [
  { bg: "bg-blue-100", text: "text-blue-700" },
  { bg: "bg-emerald-100", text: "text-emerald-700" },
  { bg: "bg-violet-100", text: "text-violet-700" },
  { bg: "bg-rose-100", text: "text-rose-700" },
  { bg: "bg-amber-100", text: "text-amber-700" },
  { bg: "bg-teal-100", text: "text-teal-700" },
  { bg: "bg-indigo-100", text: "text-indigo-700" },
  { bg: "bg-pink-100", text: "text-pink-700" },
  { bg: "bg-orange-100", text: "text-orange-700" },
];

export function getAvatarColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

// 表示名から頭文字を取得
export function getInitial(name: string): string {
  if (!name) return "?";
  return name.charAt(0).toUpperCase();
}
