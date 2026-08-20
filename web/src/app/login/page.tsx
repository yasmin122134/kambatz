"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { createClient } from "@/lib/supabase/client";

const ERROR_HINTS: Record<string, string> = {
  auth: "ההתחברות נכשלה. נסו שוב.",
  provider:
    "Google לא מופעל ב-Supabase. יש להפעיל: Dashboard → Authentication → Providers → Google, ולהוסיף Client ID/Secret מ-Google Cloud.",
};

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err && ERROR_HINTS[err]) {
      setError(ERROR_HINTS[err]);
    } else if (err) {
      setError("ההתחברות נכשלה. נסו שוב.");
    }
  }, []);

  async function signInWithGoogle() {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const next =
      new URLSearchParams(window.location.search).get("next") || "/";
    const { data, error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (authError) {
      const msg = authError.message.toLowerCase();
      if (msg.includes("provider") && msg.includes("not enabled")) {
        setError(ERROR_HINTS.provider);
      } else {
        setError(authError.message);
      }
      setLoading(false);
      return;
    }
    if (data?.url) {
      window.location.href = data.url;
    }
  }

  return (
    <PageShell
      title="התחברות צוער"
      lede="התחברו עם המייל שמופיע בדוק הפלוגה כדי לערוך את הפרטים האישיים שלכם."
    >
      <div className="card max-w-md space-y-4">
        {error && <p className="msg-err">{error}</p>}
        <button
          type="button"
          className="btn-pri w-full"
          disabled={loading}
          onClick={signInWithGoogle}
        >
          {loading ? "מעביר לגוגל…" : "התחברות עם Google"}
        </button>
        <details className="hint">
          <summary className="cursor-pointer text-ink2">
            Google לא עובד? הגדרה חד-פעמית ב-Supabase
          </summary>
          <ol className="mt-2 list-decimal mr-4 space-y-1 text-sm">
            <li>
              Supabase → Authentication → Providers → הפעילו <b>Google</b>
            </li>
            <li>
              Google Cloud Console → OAuth Client → הוסיפו Redirect URI:{" "}
              <code className="mono text-xs break-all">
                https://hwkowvgxqwkrlrnobchr.supabase.co/auth/v1/callback
              </code>
            </li>
            <li>
              Supabase → URL Configuration → Redirect URLs:{" "}
              <code className="mono text-xs">https://kambatz.vercel.app/auth/callback</code>
              {" "}וגם{" "}
              <code className="mono text-xs">http://localhost:3000/auth/callback</code>
            </li>
          </ol>
        </details>
        <p className="hint">
          יש להשתמש באותו מייל שמולא בטופס הדוק. אם המייל לא נמצא במאגר — פנו
          למפקד.
        </p>
        <Link href="/" className="text-sm text-ink2 hover:text-brick">
          ← חזרה לדף הבית
        </Link>
      </div>
    </PageShell>
  );
}
