import { test, expect } from "@playwright/test";

/**
 * Route-protection smoke tests. These exercise src/proxy.ts and the login
 * page without needing a real Supabase account, so they always run.
 */

test("signed-out visit to / redirects to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("signed-out visit to /account redirects to /login", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login$/);
});

test("login page renders the sign-in form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Music Vault" })).toBeVisible();
  await expect(page.getByPlaceholder("Email")).toBeVisible();
  await expect(page.getByPlaceholder("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
});

test("login page can switch to sign-up mode and back", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "No account? Create one" }).click();
  await expect(page.getByText("Create your account")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign up", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Already have an account? Sign in" }).click();
  await expect(page.getByText("Sign in to your library")).toBeVisible();
});

test("signed-out API requests get 401 JSON, not a redirect", async ({ request }) => {
  // The proxy answers every /api/* path for signed-out callers, whether or
  // not a route exists behind it.
  const res = await request.get("/api/any-route");
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthenticated" });
});

test("/help is public and renders the user docs", async ({ page }) => {
  await page.goto("/help");
  await expect(page).toHaveURL(/\/help$/); // no login redirect
  await expect(page.getByRole("heading", { name: "Music Vault Help" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Back to sign in/ })).toBeVisible();
});
