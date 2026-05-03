"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

export default function Home() {
  const router = useRouter();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      if (data.session) {
        router.replace("/dashboard");
      }
      setLoading(false);
    };
    checkSession();
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black"></div>
      </div>
    );
  }

  // ログイン済みなら何も表示しない（リダイレクト中）
  if (session) return null;

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans selection:bg-blue-100 overflow-x-hidden">
      {/* ナビゲーション */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center text-white font-bold text-xl">
              C
            </div>
            <span className="text-xl font-bold tracking-tight">ClassShare</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm font-medium text-gray-600 hover:text-black transition-colors">
              ログイン
            </Link>
            <Link href="/login" className="bg-black text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-gray-800 transition-all shadow-sm">
              今すぐ始める
            </Link>
          </div>
        </div>
      </nav>

      {/* ヒーローセクション */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-8 animate-in fade-in slide-in-from-left duration-1000">
            <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-xs font-bold tracking-wider uppercase">
              ✨ クラスをもっと身近に
            </div>
            <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight leading-[1.1]">
              クラスの「今」を、<br />
              <span className="text-blue-600 underline decoration-blue-100 underline-offset-8">もっと身近に。</span><br />
              もっと楽しく。
            </h1>
            <p className="text-xl text-gray-600 leading-relaxed max-w-xl">
              チャット、掲示板、作品投稿。クラス運営に必要なすべてが、ここ一つに。
              生徒と先生がもっとスムーズに、もっと楽しく繋がるための場所です。
            </p>
            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <Link href="/login" className="flex items-center justify-center bg-black text-white px-8 py-4 rounded-2xl text-lg font-bold hover:bg-gray-800 transition-all shadow-xl shadow-black/10">
                無料で使ってみる
              </Link>
              <div className="flex items-center gap-3 px-4 py-2">
                <div className="flex -space-x-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="w-8 h-8 rounded-full border-2 border-white bg-gray-200 overflow-hidden">
                      <img src={`https://i.pravatar.cc/100?img=${i+10}`} alt="user" className="w-full h-full object-cover grayscale opacity-80" />
                    </div>
                  ))}
                </div>
                <p className="text-sm text-gray-500 font-medium">
                  <span className="text-black font-bold">1,000+</span> の生徒が利用中
                </p>
              </div>
            </div>
          </div>
          <div className="relative animate-in fade-in zoom-in duration-1000 delay-200">
            <div className="absolute -inset-4 bg-gradient-to-tr from-blue-100 to-green-100 rounded-[2rem] blur-2xl opacity-60" />
            <div className="relative rounded-3xl overflow-hidden shadow-2xl border border-gray-100 bg-white">
              <img 
                src="/hero_illustration.png" 
                alt="Classroom Illustration"
                className="w-full h-auto object-cover transform hover:scale-105 transition-transform duration-700"
              />
            </div>
          </div>
        </div>
      </section>

      {/* 3つの主要機能 */}
      <section className="py-24 bg-gray-50/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center space-y-4 mb-16">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl text-black">ClassShare でできること</h2>
            <p className="text-gray-600 max-w-2xl mx-auto text-lg">直感的な操作で、クラスのコミュニケーションを劇的に変えます。</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard 
              icon="💬"
              title="リアルタイム・チャット"
              description="全員への連絡も、1対1の個別相談も。リアルタイムだから、会話がはずみます。"
              color="bg-blue-500"
            />
            <FeatureCard 
              icon="📢"
              title="みんなの掲示板"
              description="質問やアイディアを自由に投稿。スタンプや「いいね」で、交流が活性化します。"
              color="bg-green-500"
            />
            <FeatureCard 
              icon="🎨"
              title="作品・資料の共有"
              description="作った資料や絵をかんたんアップロード。みんなの作品がいつでも見られます。"
              color="bg-yellow-500"
            />
          </div>
        </div>
      </section>

      {/* 参加方法ステップ */}
      <section className="py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight text-black">かんたん 3 ステップ</h2>
          </div>
          <div className="space-y-12 relative">
            <div className="absolute left-[23px] top-4 bottom-4 w-0.5 bg-gray-100 hidden sm:block" />
            <StepItem 
              num="01"
              title="URLにアクセス"
              description="classshare.online をスマホやPCで開きます。"
            />
            <StepItem 
              num="02"
              title="ログイン"
              description="GoogleやLINEアカウントで、わずか数秒で登録完了。"
            />
            <StepItem 
              num="03"
              title="クラスに参加"
              description="先生からもらった招待コードを打つだけで、あなたのクラスが始まります。"
            />
          </div>
        </div>
      </section>

      {/* CTA セクション */}
      <section className="py-24 bg-black text-white overflow-hidden relative">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/20 rounded-full blur-[100px] -mr-48 -mt-48" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <h2 className="text-4xl font-bold mb-8 tracking-tight">さあ、あなたのクラスを始めよう。</h2>
          <Link href="/login" className="inline-flex items-center justify-center bg-white text-black px-10 py-5 rounded-2xl text-xl font-bold hover:bg-gray-100 transition-all hover:scale-105 active:scale-95 duration-200 shadow-xl shadow-white/5">
            無料で今すぐスタート
          </Link>
          <p className="mt-8 text-gray-400 text-sm italic font-medium">
            数分で準備完了。インストール不要。
          </p>
        </div>
      </section>

      {/* フッター */}
      <footer className="py-12 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-8 text-gray-500 text-sm font-medium">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-black rounded flex items-center justify-center text-white font-bold text-xs">
              C
            </div>
            <span className="font-bold text-black tracking-tight">ClassShare</span>
          </div>
          <div className="flex gap-8">
            <Link href="#" className="hover:text-black transition-colors">利用規約</Link>
            <Link href="#" className="hover:text-black transition-colors">プライバシーポリシー</Link>
          </div>
          <p>© 2024 ClassShare. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description, color }: any) {
  return (
    <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm hover:shadow-2xl hover:-translate-y-2 transition-all duration-500 group">
      <div className={`w-14 h-14 ${color} rounded-2xl flex items-center justify-center text-3xl mb-6 shadow-lg shadow-black/5 group-hover:scale-110 transition-transform`}>
        {icon}
      </div>
      <h3 className="text-xl font-bold mb-4 text-black">{title}</h3>
      <p className="text-gray-600 leading-relaxed font-medium">{description}</p>
    </div>
  );
}

function StepItem({ num, title, description }: any) {
  return (
    <div className="flex gap-6 relative group">
      <div className="w-12 h-12 bg-white text-black border-2 border-black rounded-full flex items-center justify-center font-bold text-lg shrink-0 z-10 shadow-sm group-hover:bg-black group-hover:text-white transition-colors duration-300">
        {num}
      </div>
      <div className="pt-2">
        <h3 className="text-xl font-bold mb-2 text-black">{title}</h3>
        <p className="text-gray-600 leading-relaxed font-medium">{description}</p>
      </div>
    </div>
  );
}
