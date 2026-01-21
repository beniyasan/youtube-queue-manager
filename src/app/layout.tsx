import type { Metadata } from "next";
import { Press_Start_2P, Noto_Sans_JP } from "next/font/google";
import "./globals.css";

const pressStart2P = Press_Start_2P({
  weight: "400",
  variable: "--font-pixel",
  subsets: ["latin"],
});

const notoSansJP = Noto_Sans_JP({
  weight: ["400", "500", "700"],
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Queue Manager - 参加者キューマネージャー",
  description: "YouTube参加型ライブ配信の参加者管理システム",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${pressStart2P.variable} ${notoSansJP.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
