// @ts-check
import { defineConfig } from 'astro/config';

// The site's own address is never written into the repo: private/publish.mjs
// refuses real *.vercel.app hosts, and the address is chosen in Vercel.
// Vercel sets VERCEL_PROJECT_PRODUCTION_URL on every build (production and
// preview), so canonical and social-card URLs always name the production site.
// Locally they fall back to the dev server.
const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;

export default defineConfig({
  site: productionHost ? `https://${productionHost}` : 'http://localhost:4321',
  output: 'static',
  trailingSlash: 'ignore',
  build: {
    // One page: inlining its CSS saves a render-blocking request.
    inlineStylesheets: 'always',
  },
  // Hashes every inline script and style into a CSP <meta> tag. vercel.json
  // adds the directives a <meta> tag cannot carry (frame-ancestors).
  security: {
    csp: true,
  },
  // No Markdown pages, and Shiki's inline styles would conflict with the CSP.
  markdown: {
    syntaxHighlight: false,
  },
  devToolbar: {
    enabled: false,
  },
});
