import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="bg-olive text-bone border-b-[3px] border-ink">
      <div className="mx-auto flex max-w-3xl flex-wrap items-end gap-4 px-5 py-5">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-olive-light">
            גדוד אלון · הגנ״ם
          </p>
          <h1 className="font-display text-2xl leading-tight">לוח שמירות</h1>
        </div>
        <nav className="mr-auto flex flex-wrap gap-2 text-sm">
          <Link href="/report" className="stamp">
            דיווח חסימה
          </Link>
          <Link href="/admin" className="stamp">
            ניהול
          </Link>
          <Link href="/scheduler.html" className="stamp">
            מחולל
          </Link>
        </nav>
      </div>
    </header>
  );
}
