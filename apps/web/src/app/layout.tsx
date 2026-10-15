import type { Metadata, Viewport } from "next";
import "@fontsource-variable/figtree";
import "./globals.css";

export const metadata: Metadata = {
  title: "Music Vault",
  description: "Your music library, on every device.",
  // iOS ignores the manifest's display mode; these make the home-screen app standalone.
  appleWebApp: { capable: true, title: "Music Vault", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0d0d10",
};

/**
 * Applies the saved theme before first paint. Settings live in the sync
 * engine; this mirror in localStorage only prevents a theme flash.
 */
const themeBoot = `
try {
  var root = document.documentElement;
  var t = localStorage.getItem("mv.theme") || "dark";
  if (localStorage.getItem("mv.followSystem") === "1") {
    t = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  root.setAttribute("data-theme", t);
  if (t === "dark" && localStorage.getItem("mv.amoled") === "1") root.setAttribute("data-amoled", "true");
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
        {children}
      </body>
    </html>
  );
}
