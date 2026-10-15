import { redirect } from "next/navigation";
import { getSupabaseServer } from "../../lib/supabase/server";
import { AccountForm } from "./AccountForm";

export const metadata = { title: "Account — Music Vault" };

// Always render per-request: the page reads the session from cookies.
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const supabase = await getSupabaseServer();
  if (!supabase) redirect("/login");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: devices }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("devices").select("*").order("last_seen_at", { ascending: false }),
  ]);

  return (
    <AccountForm
      email={user.email ?? ""}
      createdAt={user.created_at}
      displayName={profile?.display_name ?? ""}
      devices={(devices ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        platform: d.platform,
        lastSeenAt: d.last_seen_at,
      }))}
    />
  );
}
