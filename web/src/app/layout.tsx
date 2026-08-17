import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "לוח שמירות — Bahadix",
  description: "מערכת שיבוץ שמירות ודיווח חסימות שעות",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
