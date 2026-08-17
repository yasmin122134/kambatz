"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "auth") {
      setError("ההתחברות נכשלה. נסו שוב.");
    }
  }, []);

  async function signInWithGoogle() {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const next =
      new URLSearchParams(window.location.search).get("next") || "/profile";
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (authError) {
      setError(authError.message);
      setLoading(false);
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
