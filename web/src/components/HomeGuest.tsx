import Link from "next/link";

export function HomeGuest() {
  return (
    <section className="card mb-6 border-dashed">
      <h2 className="font-display text-lg mb-2">ברוכים הבאים</h2>
      <p className="lede mb-3">
        התחברו עם Google כדי לראות את המשמרות והמשימות שלכם.
      </p>
      <Link href="/login?next=/" className="btn-pri btn-sm">
        התחברות עם Google
      </Link>
    </section>
  );
}
