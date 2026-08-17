import Link from "next/link";

export function HomeUnknownUser({ email }: { email: string }) {
  return (
    <section className="card mb-6">
      <h2 className="font-display text-lg mb-2">לא נמצא במאגר</h2>
      <p className="lede mb-3">
        התחברתם כ-<span className="mono text-sm">{email}</span>, אבל המייל לא
        מופיע ברשימת המחזור. פנו למפקד לעדכון הדוק.
      </p>
      <Link href="/login" className="btn-sm">
        נסו מייל אחר
      </Link>
    </section>
  );
}
