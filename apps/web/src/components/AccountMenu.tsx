"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Bell, CircleHelp, CloudOff, Download, LogIn, LogOut, RefreshCw, UserRound, WifiOff } from "lucide-react";
import { installApp, useCanInstall } from "../lib/pwa";
import { useAuthStore } from "../store/authStore";
import { useSyncStore } from "../store/syncStore";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { NotificationToggle } from "./NotificationToggle";
import { Button } from "./ui/Button";

/** Top-bar avatar: account, sync state and app settings (theme, notifications). */
export function AccountMenu() {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const session = useAuthStore((s) => s.session);
  const signOut = useAuthStore((s) => s.signOut);
  const [open, setOpen] = useState(false);
  const canInstall = useCanInstall();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Dismiss on outside click / Escape, the way a menu is expected to behave.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
    router.refresh();
  };

  const email = session?.user.email ?? null;
  const signedIn = status === "signedIn" && !!session;

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={signedIn ? (email ?? "Account") : "Account"}
        className="relative w-9 h-9 rounded-full flex items-center justify-center transition-transform active:scale-95"
      >
        <Avatar email={signedIn ? email : null} disabled={status === "disabled"} />
        {signedIn && <SyncDot />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformOrigin: "top right" }}
            className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-1rem)] z-50 rounded-2xl border border-line bg-surface shadow-[0_20px_60px_-15px_rgb(0_0_0/0.6)] overflow-hidden"
          >
            {status === "disabled" ? (
              <div
                className="px-4 py-4 flex items-center gap-3 text-sm text-muted"
                title="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable sync"
              >
                <CloudOff className="w-5 h-5 shrink-0" /> Not configured
              </div>
            ) : signedIn ? (
              <div className="px-4 py-4 flex items-center gap-3">
                <Avatar email={email} large />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate" title={email ?? undefined}>
                    {email}
                  </div>
                  <div className="text-xs text-muted">Signed in</div>
                </div>
              </div>
            ) : (
              <div className="p-4">
                <Link href="/login" onClick={() => setOpen(false)}>
                  <Button variant="primary" className="w-full" icon={<LogIn className="w-4 h-4" />}>
                    Sign in
                  </Button>
                </Link>
              </div>
            )}
            {signedIn && <SyncRow />}
            <div className="border-t border-line py-2">
              <SectionLabel>Appearance</SectionLabel>
              <ThemeSwitcher />
              <SectionLabel>
                <Bell className="w-3.5 h-3.5" /> Notifications
              </SectionLabel>
              <NotificationToggle />
            </div>
            <div className="border-t border-line py-1.5">
              {canInstall && (
                <button
                  onClick={() => {
                    setOpen(false);
                    void installApp();
                  }}
                  className="w-full flex items-center gap-3 px-4 h-11 text-sm text-muted hover:text-fg hover:bg-surface-2 transition-colors"
                >
                  <Download className="w-4 h-4" /> Install app
                </button>
              )}
              <MenuLink href="/help" onClick={() => setOpen(false)} icon={<CircleHelp className="w-4 h-4" />}>
                Help
              </MenuLink>
              {signedIn && (
                <button
                  onClick={() => {
                    setOpen(false);
                    void handleSignOut();
                  }}
                  className="w-full flex items-center gap-3 px-4 h-11 text-sm text-muted hover:text-fg hover:bg-surface-2 transition-colors"
                >
                  <LogOut className="w-4 h-4" /> Sign out
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuLink({
  href,
  onClick,
  icon,
  children,
}: {
  href: string;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 h-11 text-sm text-muted hover:text-fg hover:bg-surface-2 transition-colors"
    >
      {icon}
      {children}
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 px-4 pt-2 pb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-subtle">
      {children}
    </div>
  );
}

/** Initial on a violet disc (signed in), a person glyph otherwise. */
function Avatar({ email, large = false, disabled = false }: { email: string | null; large?: boolean; disabled?: boolean }) {
  const size = large ? "w-11 h-11 text-lg" : "w-9 h-9 text-sm";
  if (email) {
    return (
      <span
        className={`${size} rounded-full bg-gradient-to-br from-violet-400 to-violet-700 text-white font-bold flex items-center justify-center shrink-0 select-none`}
      >
        {email.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <span className={`${size} rounded-full bg-surface-2 hover:bg-surface-3 text-muted flex items-center justify-center shrink-0 transition-colors`}>
      {disabled ? <CloudOff className="w-4 h-4" /> : <UserRound className="w-4 h-4" />}
    </span>
  );
}

/** At-a-glance sync state on the avatar, so the menu can stay shut. */
function SyncDot() {
  const status = useSyncStore((s) => s.status);
  if (!status) return null;

  const color =
    status.phase === "error"
      ? "bg-amber-400"
      : status.phase === "offline"
        ? "bg-subtle"
        : status.phase === "syncing"
          ? "bg-accent animate-pulse"
          : status.pendingOps > 0
            ? "bg-accent"
            : null;
  if (!color) return null;

  return <span className={`absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full border-2 border-bg ${color}`} />;
}

/** Sync engine status: phase, queued op count, manual sync trigger. */
function SyncRow() {
  const status = useSyncStore((s) => s.status);
  const syncNow = useSyncStore((s) => s.syncNow);
  if (!status) return null;

  const label =
    status.phase === "syncing"
      ? "Syncing…"
      : status.phase === "offline"
        ? "Offline — changes queued"
        : status.phase === "error"
          ? "Sync issue — will retry"
          : status.pendingOps > 0
            ? `${status.pendingOps} change${status.pendingOps === 1 ? "" : "s"} queued`
            : "Everything synced";

  const icon =
    status.phase === "offline" ? (
      <WifiOff className="w-4 h-4 shrink-0 text-muted" />
    ) : status.phase === "error" ? (
      <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
    ) : (
      <RefreshCw className={`w-4 h-4 shrink-0 ${status.phase === "syncing" ? "animate-spin text-accent" : "text-muted"}`} />
    );

  return (
    <div className="px-4 h-12 flex items-center gap-3 border-t border-line" title={status.lastError ?? undefined}>
      {icon}
      <span className="flex-1 truncate text-sm text-muted">{label}</span>
      <Button size="sm" variant="secondary" onClick={() => void syncNow()} disabled={status.phase === "syncing"}>
        Sync now
      </Button>
    </div>
  );
}
