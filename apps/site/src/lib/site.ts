import rootPackage from '../../../../package.json';

/** The public repository: every outbound link on the page points into it. */
export const REPO = 'https://github.com/naimulnashid/music-vault';

/** A file on the public repository's main branch, as GitHub renders it. */
export const repoFile = (path: string) => `${REPO}/blob/main/${path}`;

export const SITE = {
  name: 'Music Vault',
  title: 'Music Vault: your music, in your own vault',
  description:
    'A free, open-source music library and player for Windows, Android and the web. ' +
    'Your songs live in your own Cloudflare R2 bucket and your library in your own Supabase project.',
  // Read from the root package.json so a release bump updates the footer too.
  version: rootPackage.version,
  author: 'Md. Naimul Hasan Nashid',
};

export const LINKS = {
  repo: REPO,
  issues: `${REPO}/issues`,
  releases: `${REPO}/releases`,
  license: repoFile('LICENSE'),
  security: repoFile('SECURITY.md'),
  setup: repoFile('docs/setup.md'),
  setupSupabase: repoFile('docs/setup-supabase.md'),
  setupSignups: `${repoFile('docs/setup-supabase.md')}#5-auth-settings-recommended`,
  vaultSetup: repoFile('docs/vault-setup.md'),
  webSetup: repoFile('docs/web-setup.md'),
  architecture: repoFile('docs/architecture.md'),
  syncProtocol: repoFile('docs/sync-protocol.md'),
  features: repoFile('reports/FEATURES.md'),
  parity: repoFile('reports/FEATURE_PARITY.md'),
};
