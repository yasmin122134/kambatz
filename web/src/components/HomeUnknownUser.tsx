import Link from "next/link";

type Props = {
  email: string;
  emailsNotReady?: boolean;
  /** Logged in but not on roster — may view published board without self-assign. */
  viewerAllowed?: boolean;
};

export function HomeUnknownUser({ email, emailsNotReady, viewerAllowed }: Props) {
  if (emailsNotReady) {
    return (
      <section className="card mb-6">
        <h2 className="font-display text-lg mb-2">ההתחברות הצליחה — המיילים עדיין לא במאגר</h2>
        <p className="lede mb-3">
          התחברתם כ-<span className="mono text-sm">{email}</span>. Google עובד,
          אבל טבלת הצוערים עדיין בלי עמודת מייל — המפקד צריך להריץ migration
          ולסנכרן את הדוק.
        </p>
        <p className="hint text-sm">
          Admin → סנכרן מיילים מהדוק (אחרי הרצת{" "}
          <code className="mono">migration_email_auth.sql</code> ב-Supabase SQL
          Editor)
        </p>
      </section>
    );
  }

  if (viewerAllowed) {
    return (
      <section className="card mb-6">
        <h2 className="font-display text-lg mb-2">צפייה בלבד</h2>
        <p className="lede mb-3">
          התחברתם כ-<span className="mono text-sm">{email}</span>. המייל לא
          נמצא בדוק הצוערים — אפשר לצפות בשמירות, מטבח ועב״ס, אבל לא לשבץ את
          עצמכם.
        </p>
        <p className="hint text-sm mb-4">
          צוער/ית? ודאו שהתחברתם עם אותו מייל שמולא בטופס, או פנו למפקד.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/board" className="btn-pri">
            לרשימה המלאה
          </Link>
          <Link href="/fairness" className="btn-sm">
            טבלת צדק
          </Link>
          <Link href="/login" className="btn-sm">
            נסו מייל אחר
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="card mb-6">
      <h2 className="font-display text-lg mb-2">לא נמצא במאגר</h2>
      <p className="lede mb-3">
        התחברתם כ-<span className="mono text-sm">{email}</span>, אבל המייל הזה
        לא תואם לאף צוער בדוק. ודאו שהתחברתם עם אותו מייל שמולא בטופס, או פנו
        למפקד.
      </p>
      <Link href="/login" className="btn-sm">
        נסו מייל אחר
      </Link>
    </section>
  );
}
