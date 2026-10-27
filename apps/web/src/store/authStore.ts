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
  /**
   * Device registration for this session has been tried (it may have failed, e.g. offline).
   * Sync waits for it, so it starts once with the device id instead of again when it lands.
   */
  deviceReady: boolean;
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
  // Automated and embedded browsers (tests, an app's built-in browser) report
  // as Chrome; named apart, their plays don't pass for the owner's own browser.
  if (navigator.webdriver) return "Web (test browser)";
  if (/Electron\//.test(ua)) return "Web (built-in app browser)";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  return os ? `Web (${browser} on ${os})` : `Web (${browser})`;
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

let registration: { userId: string; done: Promise<string | null> } | null = null;

/**
 * One registration per signed-in account: startup, sign-in and the auth listener all
 * ask, and a session that drops and comes back reuses the id it already got.
 */
function registerOnce(session: Session): Promise<string | null> {
  if (registration?.userId !== session.user.id) {
    registration = { userId: session.user.id, done: ensureDeviceRegistered(session) };
  }
  return registration.done;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "loading",
  session: null,
  deviceId: null,
  deviceReady: false,
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
          const deviceId = await registerOnce(session);
          set({ status: "signedIn", session, deviceId, deviceReady: true });
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
        deviceReady: session ? state.deviceReady : false,
        // This event also fires for our own signOut (before it returns).
        signedOutByUser: session ? false : signingOut,
      }));
      // A session that came back on its own (after a refresh failure) needs the device
      // id again before sync restarts; startup and sign-in set it themselves.
      if (session && !useAuthStore.getState().deviceReady) {
        void registerOnce(session).then((deviceId) => {
          if (useAuthStore.getState().session?.user.id === session.user.id) set({ deviceId, deviceReady: true });
        });
      }
    });
  },

  signIn: async (email, password) => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return false;
    try {
      const { session } = await coreSignIn(supabase, email, password);
      if (session) {
        const deviceId = await registerOnce(session);
        set({ status: "signedIn", session, deviceId, deviceReady: true, error: null });
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
        const deviceId = await registerOnce(session);
        set({ status: "signedIn", session, deviceId, deviceReady: true, error: null });
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
    registration = null;
    set({ status: "signedOut", session: null, deviceId: null, deviceReady: false, signedOutByUser: true });
  },

  clearError: () => set({ error: null }),
}));
