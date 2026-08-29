import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./editor-extras.css";
import "./product-v2.css";
import "./product-v2-fixes.css";

export const metadata: Metadata = {
  title: {
    default: "AI Book Studio",
    template: "%s · AI Book Studio"
  },
  description: "아이디어부터 Book Blueprint, 장문 집필, 수정, 버전 관리와 출판 파일까지 이어지는 AI 책 제작 작업실.",
  applicationName: "AI Book Studio"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5f5f2",
  colorScheme: "light"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
