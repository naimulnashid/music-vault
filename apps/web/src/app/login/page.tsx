"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LogoMark } from "../../components/Logo";
import { useAuthStore } from "../../store/authStore";
import { getSupabaseBrowser } from "../../lib/supabase/browser";

export default function LoginPage() {
  const router = useRouter();
  const signIn = useAuthStore((s) => s.signIn);
  const signUp = useAuthStore((s) => s.signUp);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (!getSupabaseBrowser()) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <p className="text-sm text-muted max-w-sm text-center">
          This deployment is not configured. Set NEXT_PUBLIC_SUPABASE_URL and
          NEXT_PUBLIC_SUPABASE_ANON_KEY, then rebuild.
        </p>
      </main>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const ok = mode === "signIn" ? await signIn(email, password) : await signUp(email, password);
    setBusy(false);
    if (!ok) return;
    if (mode === "signUp" && useAuthStore.getState().status !== "signedIn") {
      setNotice("Check your email to confirm the account, then sign in.");
      setMode("signIn");
      return;
    }
    // The proxy reads auth from cookies — refresh so it sees the new session.
    router.replace("/");
    router.refresh();
  };

  const inputClass = "mv-field h-11";

  return (
    <main className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden">
      {/* Soft violet glow behind the card */}
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full bg-accent/25 blur-[140px]" />
      <div className="relative w-full max-w-sm rounded-3xl bg-surface/80 backdrop-blur-xl border border-line p-8 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.6)] animate-slide-up">
        <div className="flex flex-col items-center gap-3 mb-7">
          <LogoMark className="w-14 h-14 drop-shadow-[0_10px_25px_rgb(139_92_246/0.45)]" />
          <h1 className="text-2xl font-extrabold tracking-tight">Music Vault</h1>
          <p className="text-sm text-muted">
            {mode === "signIn" ? "Sign in to your library" : "Create your account"}
          </p>
        </div>

        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <input
            type="email"
            required
            autoFocus
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />

          {error && <p className="text-xs text-danger">{error}</p>}
          {notice && <p className="text-xs text-accent">{notice}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full h-11 rounded-full text-sm font-semibold bg-accent text-accent-fg hover:bg-accent-hover active:scale-[0.98] transition-[background-color,transform] disabled:opacity-50"
          >
            {busy ? "Please wait…" : mode === "signIn" ? "Sign in" : "Sign up"}
          </button>
        </form>

        <button
          onClick={() => {
            clearError();
            setNotice(null);
            setMode(mode === "signIn" ? "signUp" : "signIn");
          }}
          className="mt-5 w-full text-sm text-muted hover:text-fg"
        >
          {mode === "signIn" ? "No account? Create one" : "Already have an account? Sign in"}
        </button>

        <a
          href="/help"
          className="mt-2 block w-full text-center text-xs text-subtle hover:text-fg"
        >
          What is Music Vault? — Help
        </a>
      </div>
    </main>
  );
}
