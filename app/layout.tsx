import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Book Studio",
  description: "Plan, write, remember, edit and publish complete books with AI."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
