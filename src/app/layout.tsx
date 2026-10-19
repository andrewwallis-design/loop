import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Loop",
  description: "Ask, listen, act, tell.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
