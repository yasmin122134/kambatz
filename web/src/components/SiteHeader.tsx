"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "דף הבית" },
  { href: "/board", label: "רשימה מלאה" },
  { href: "/fairness", label: "טבלת צדק" },
  { href: "/report", label: "אילוצים" },
  { href: "/profile", label: "פרופיל" },
  { href: "/admin", label: "ניהול" },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/scheduler.html") return pathname === "/scheduler.html";
  return pathname.startsWith(href);
}

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="app-header">
      <div className="mx-auto flex max-w-6xl flex-wrap items-end gap-4 px-5 py-5">
        <Link href="/" className="group no-underline text-inherit">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/70 group-hover:text-white">
            גדוד אלון · הגנ״ם
          </p>
          <h1 className="font-display text-2xl leading-tight group-hover:opacity-90">
            לוח שמירות
          </h1>
        </Link>
        <nav className="mr-auto flex flex-wrap gap-2 text-sm">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`stamp ${isActive(pathname, href) ? "on" : ""}`}
              aria-current={isActive(pathname, href) ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
