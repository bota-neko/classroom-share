import { createClient } from "@supabase/supabase-js";

// 環境変数からSupabase接続情報を取得
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const supabaseSchema = process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || "public";
export const supabaseStorageBucket =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || "uploads";

// Supabaseクライアントを作成（ブラウザ側で使用）
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: { schema: supabaseSchema },
});
