import Link from "next/link";

type Props = {
  email: string;
  emailsNotReady?: boolean;
};

export function HomeUnknownUser({ email, emailsNotReady }: Props) {
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
