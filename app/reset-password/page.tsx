"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/reset-password/confirm`,
    });
    setLoading(false);
    if (error) {
      alert("送信に失敗しました: " + error.message);
      return;
    }
    setSent(true);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-white px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <span className="text-4xl text-black" style={{ fontFamily: "var(--font-lobster)" }}>
            Classroom-Share
          </span>
        </div>

        {sent ? (
          <div className="text-center">
            <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">✉️</span>
            </div>
            <h1 className="text-xl font-semibold text-black mb-2">メールを送信しました</h1>
            <p className="text-sm text-gray-500 mb-6">
              <span className="font-medium text-black">{email}</span> にパスワードリセット用のリンクを送りました。メールをご確認ください。
            </p>
            <Link href="/login" className="text-sm text-black font-medium hover:underline">
              ログインページに戻る
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-center mb-1 text-black">
              パスワードリセット
            </h1>
            <p className="text-sm text-gray-500 text-center mb-8">
              登録したメールアドレスにリセット用リンクを送ります
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
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
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-black text-white rounded-lg hover:bg-gray-800 disabled:bg-gray-400 font-medium text-sm"
              >
                {loading ? "送信中..." : "リセットメールを送る"}
              </button>
            </form>
            <p className="text-sm text-center mt-6">
              <Link href="/login" className="text-gray-400 hover:text-black hover:underline text-xs">
                ログインページに戻る
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
