"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error || !data.user) {
      alert("登録に失敗しました: " + (error?.message || "不明なエラー"));
      setLoading(false);
      return;
    }

    if (data.session) {
      const { error: profileError } = await supabase.from("profiles").insert({
        id: data.user.id,
        display_name: displayName,
      });
      if (profileError) console.log("プロフィール作成エラー:", profileError);
      router.push("/dashboard");
    } else {
      alert("登録完了！メールで確認してログインしてください");
      router.push("/login");
    }
    setLoading(false);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-white px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <div className="w-12 h-12 bg-black rounded-xl flex items-center justify-center text-white font-bold text-xl">
            C
          </div>
        </div>
        <h1 className="text-2xl font-semibold text-center mb-1 text-black">
          新規登録
        </h1>
        <p className="text-sm text-gray-500 text-center mb-8">
          アカウントを作成
        </p>
        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              表示名
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black focus:border-black"
              placeholder="山田太郎"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              メールアドレス
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black focus:border-black"
              placeholder="example@mail.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              パスワード（6文字以上）
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black focus:border-black"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-black text-white rounded-lg hover:bg-gray-800 disabled:bg-gray-400 font-medium text-sm"
          >
            {loading ? "登録中..." : "登録"}
          </button>
        </form>
        <p className="text-sm text-center mt-6 text-gray-500">
          すでにアカウントをお持ちの方は{" "}
          <Link href="/login" className="text-black font-medium hover:underline">
            ログイン
          </Link>
        </p>
      </div>
    </div>
  );
}
