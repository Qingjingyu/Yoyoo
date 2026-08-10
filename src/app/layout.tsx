import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Yoyoo Space",
  description: "人与数字生命的私人协作空间。",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#070b0a",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
