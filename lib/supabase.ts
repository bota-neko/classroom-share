import { createClient } from "@supabase/supabase-js";

// 環境変数からSupabase接続情報を取得
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Supabaseクライアントを作成（ブラウザ側で使用）
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
