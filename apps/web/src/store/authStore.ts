import { create } from "zustand";
import {
  getSession,
  onAuthStateChange,
  registerDevice,
  signIn as coreSignIn,
  signOut as coreSignOut,
  signUp as coreSignUp,
  type Session,
} from "@musicvault/core";
import { getSupabaseBrowser } from "../lib/supabase/browser";

const DEVICE_ID_KEY = "mv.deviceId";

export type AuthStatus =
  | "disabled" // no Supabase env configured
  | "loading"
  | "signedOut"
  | "signedIn";

interface AuthState {
  status: AuthStatus;
  session: Session | null;
  /** id of this browser's row in the devices table (null until registered) */
  deviceId: string | null;
  error: string | null;
  /**
   * Whether the last move to signedOut was the user's own Sign out. A session
   * that expired or was revoked also signs out, but must keep unsynced edits.
   */
  signedOutByUser: boolean;
  init: () => void;
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

function deviceName(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  return `Web (${browser})`;
}

async function ensureDeviceRegistered(session: Session): Promise<string | null> {
  const supabase = getSupabaseBrowser();
  if (!supabase) return null;
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY) ?? undefined;
    const device = await registerDevice(
      supabase,
      session.user.id,
      { name: deviceName(), platform: "web" },
      stored,
    );
    localStorage.setItem(DEVICE_ID_KEY, device.id);
    return device.id;
  } catch (err) {
    console.error("device registration failed", err);
    return null;
  }
}

let initialized = false;
/** True while our own signOut runs, so its SIGNED_OUT event counts as the user's. */
let signingOut = false;

export const useAuthStore = create<AuthState>((set) => ({
  status: "loading",
  session: null,
  deviceId: null,
  error: null,
  signedOutByUser: false,

  init: () => {
    if (initialized) return;
    initialized = true;
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      set({ status: "disabled" });
      return;
    }
    void getSession(supabase)
      .then(async (session) => {
        if (session) {
          const deviceId = await ensureDeviceRegistered(session);
          set({ status: "signedIn", session, deviceId });
        } else {
          set({ status: "signedOut", session: null });
        }
      })
      .catch((err) => {
        console.error("auth init failed", err);
        set({ status: "signedOut", session: null });
      });

    onAuthStateChange(supabase, (session) => {
      set((state) => ({
        status: session ? "signedIn" : "signedOut",
        session,
        deviceId: session ? state.deviceId : null,
        // This event also fires for our own signOut (before it returns).
        signedOutByUser: session ? false : signingOut,
      }));
    });
  },

  signIn: async (email, password) => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return false;
    try {
      const { session } = await coreSignIn(supabase, email, password);
      if (session) {
        const deviceId = await ensureDeviceRegistered(session);
        set({ status: "signedIn", session, deviceId, error: null });
        return true;
      }
      set({ error: "Sign-in did not return a session." });
      return false;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Sign-in failed." });
      return false;
    }
  },

  signUp: async (email, password) => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return false;
    try {
      const { session } = await coreSignUp(supabase, email, password);
      if (session) {
        const deviceId = await ensureDeviceRegistered(session);
        set({ status: "signedIn", session, deviceId, error: null });
        return true;
      }
      // email confirmation enabled on the project: no session until confirmed
      set({ error: null, status: "signedOut" });
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Sign-up failed." });
      return false;
    }
  },

  signOut: async () => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    signingOut = true;
    try {
      await coreSignOut(supabase);
    } catch (err) {
      console.error("sign-out failed", err);
    } finally {
      signingOut = false;
    }
    set({ status: "signedOut", session: null, deviceId: null, signedOutByUser: true });
  },

  clearError: () => set({ error: null }),
}));
