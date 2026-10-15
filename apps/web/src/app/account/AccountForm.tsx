"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, LogOut, MonitorSmartphone, Save, UserRound } from "lucide-react";
import { useAuthStore } from "../../store/authStore";
import { getSupabaseBrowser } from "../../lib/supabase/browser";

interface DeviceItem {
  id: string;
  name: string;
  platform: string;
  lastSeenAt: string;
}

export function AccountForm(props: {
  email: string;
  createdAt: string;
  displayName: string;
  devices: DeviceItem[];
}) {
  const router = useRouter();
  const signOut = useAuthStore((s) => s.signOut);
  const [displayName, setDisplayName] = useState(props.displayName);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const supabase = getSupabaseBrowser();
    if (!supabase || saving) return;
    setSaving(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }
    const { error: err } = await supabase
      .from("profiles")
      .upsert({ id: user.id, display_name: displayName.trim() || null });
    setSaving(false);
    if (err) {
      setError(err.message);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
    router.refresh();
  };

  const inputClass =
    "w-full px-3 py-2 text-sm rounded-md bg-surface-2 border border-line focus:outline-none focus:border-accent";

  return (
    <main className="min-h-screen flex justify-center p-4 md:p-8">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/")}
            title="Back to library"
            className="text-muted hover:text-fg"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-semibold">Account</h1>
        </div>

        <section className="rounded-xl bg-surface border border-line p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center">
              <UserRound className="w-5 h-5 text-accent" />
            </div>
            <div className="min-w-0">
              <p className="text-sm truncate">{props.email}</p>
              <p className="text-xs text-muted">
                Member since {new Date(props.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted">Display name</label>
            <div className="flex gap-2">
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                className={inputClass}
              />
              <button
                onClick={() => void save()}
                disabled={saving}
                className="px-3 py-2 rounded-md text-sm bg-accent text-accent-fg hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
              >
                <Save className="w-4 h-4" />
                {saved ? "Saved" : "Save"}
              </button>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        </section>

        <section className="rounded-xl bg-surface border border-line p-5">
          <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
            <MonitorSmartphone className="w-4 h-4 text-accent" /> Devices
          </h2>
          <ul className="space-y-2">
            {props.devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between text-sm">
                <span className="truncate">{d.name}</span>
                <span className="text-xs text-muted shrink-0 ml-3">
                  {d.platform} · {new Date(d.lastSeenAt).toLocaleDateString()}
                </span>
              </li>
            ))}
            {props.devices.length === 0 && (
              <li className="text-xs text-muted">No devices registered yet.</li>
            )}
          </ul>
        </section>

        <button
          onClick={() => void handleSignOut()}
          className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300"
        >
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </div>
    </main>
  );
}
