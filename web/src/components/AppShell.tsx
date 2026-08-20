"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Props = {
  children: React.ReactNode;
  title?: string;
};

export function AppShell({ children, title }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch("/api/admin/me")
      .then((r) => r.json())
      .then((d) => setIsAdmin(!!d.admin))
      .catch(() => setIsAdmin(false));
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const links = [
    { href: "/fairness", label: "טבלת צדק" },
    { href: "/profile", label: "פרופיל" },
    { href: "/report", label: "אילוצים" },
    ...(isAdmin ? [{ href: "/admin", label: "דף מנהל" }] : []),
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-olive text-bone border-b-[3px] border-ink sticky top-0 z-40">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-4">
          <button
            type="button"
            className="menu-btn"
            aria-label="תפריט"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
          <Link href="/" className="font-display text-xl no-underline text-inherit">
            {title || "לוח שמירות"}
          </Link>
        </div>
        {open && (
          <>
            <div
              className="fixed inset-0 bg-black/30 z-40"
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <nav className="menu-drawer z-50" aria-label="תפריט ראשי">
              {links.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className={pathname.startsWith(href) ? "on" : ""}
                >
                  {label}
                </Link>
              ))}
            </nav>
          </>
        )}
      </header>
      {children}
    </div>
  );
}
