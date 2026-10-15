import { test, expect, type Page } from "@playwright/test";

/**
 * Authenticated flows: sign in → browse views → playlist create/delete.
 *
 * These need a real Supabase test account. Set E2E_EMAIL and E2E_PASSWORD
 * (e.g. in your shell or CI secrets) to run them; they skip otherwise.
 * Use a dedicated throwaway account — the playlist test writes real rows.
 */

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

test.skip(!EMAIL || !PASSWORD, "E2E_EMAIL / E2E_PASSWORD not set");

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(EMAIL!);
  await page.getByPlaceholder("Password").fill(PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // The proxy redirects to / once cookies land; the shell is client-only.
  await page.waitForURL(/\/$/, { timeout: 30_000 });
}

test("sign in lands on the library shell", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText("All Tracks")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Playlists", { exact: true })).toBeVisible();
});

test("signed-in visit to /login bounces back to the app", async ({ page }) => {
  await signIn(page);
  await page.goto("/login");
  await expect(page).toHaveURL(/\/$/);
});

test("browse: albums and statistics views render", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText("All Tracks")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Albums" }).click();
  // Album grid or its empty state — either proves the view mounted.
  await expect(page.getByText(/Albums|No albums/i).first()).toBeVisible();

  await page.getByRole("button", { name: "Statistics" }).click();
  await expect(page.getByText(/Listening|Statistics|No listening/i).first()).toBeVisible();
});

test("playlist: create, see it in the sidebar, delete it", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText("Playlists", { exact: true })).toBeVisible({ timeout: 30_000 });

  const name = `e2e-playlist-${Date.now()}`;
  await page.getByTitle("New playlist").click();
  await page.getByPlaceholder("Playlist name").fill(name);
  await page.getByPlaceholder("Playlist name").press("Enter");

  // Creating a playlist navigates to it and lists it in the sidebar.
  const sidebarEntry = page.getByRole("button", { name });
  await expect(sidebarEntry).toBeVisible();

  await page.getByTitle("Delete playlist").click();
  await expect(sidebarEntry).not.toBeVisible();
});
