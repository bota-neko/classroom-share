import type { Metadata } from "next";
import { Noto_Sans_JP, Lobster } from "next/font/google";
import "./globals.css";

const notoTasksJP = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-noto-sans-jp",
});

export const lobster = Lobster({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-lobster",
});

// アプリ全体のメタデータ
export const metadata: Metadata = {
  title: "Classroom Chat",
  description: "クラス単位のチャットアプリ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className={`${notoTasksJP.className} ${lobster.variable} min-h-screen bg-white text-black`}>
        {children}
      </body>
    </html>
  );
}
