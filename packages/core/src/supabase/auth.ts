import type { Session, User } from "@supabase/supabase-js";
import type { MusicVaultClient } from "./client";

export type { Session, User };

export interface AuthResult {
  user: User | null;
  session: Session | null;
}

export async function signUp(
  client: MusicVaultClient,
  email: string,
  password: string,
  displayName?: string,
): Promise<AuthResult> {
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: displayName ? { data: { display_name: displayName } } : undefined,
  });
  if (error) throw error;
  return { user: data.user, session: data.session };
}

export async function signIn(client: MusicVaultClient, email: string, password: string): Promise<AuthResult> {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { user: data.user, session: data.session };
}

export async function signOut(client: MusicVaultClient): Promise<void> {
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function getSession(client: MusicVaultClient): Promise<Session | null> {
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

/** Subscribes to auth changes; returns an unsubscribe function. */
export function onAuthStateChange(
  client: MusicVaultClient,
  callback: (session: Session | null) => void,
): () => void {
  const { data } = client.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}
