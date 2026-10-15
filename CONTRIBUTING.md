# Contributing

Thanks for looking. This is a personal music player shared as is, so the bar
is: keep it working for its one real use, and keep the three apps in step.

- **Bugs and questions:** open an issue. Please leave out your own library,
  account and project details; describe the shape of the problem instead.
- **Small fixes:** a pull request is welcome.
- **Anything larger:** open an issue first, so we can agree it fits before you
  spend the time.
- **Security issues:** not in a public issue; see [SECURITY.md](SECURITY.md).

## Before sending a change

```bash
npm run core:test
npm run desktop:typecheck && npm run desktop:lint && npm run desktop:test
npm run web:typecheck && npm run web:lint && npm run web:test && npm run web:build
npm run vault:test
cd apps/desktop/src-tauri && cargo test
cd apps/android && ./gradlew testDebugUnitTest
```

None of these needs an account or real music. [docs/setup.md](docs/setup.md)
covers running the apps against your own Supabase project and R2 bucket.

## Conventions

- **Conventional commit messages** (`feat:`, `fix:`, `docs:`), one concern per
  commit.
- **Desktop and web share their components file for file.** A change to a
  shared component in `apps/desktop/src/components/` goes into
  `apps/web/src/components/` too; platform differences live in a few files such
  as `AlbumArt.tsx` and `lib/trackState.ts`.
- **The TypeScript and Kotlin engines must agree.** Sync, smart rules,
  statistics and track editing exist in `packages/core` and again in the
  Android app, pinned by the golden fixtures in `docs/fixtures/`. Change both
  and the fixture together.
- **Migrations are append-only.** Add a new file under `supabase/migrations/`;
  never edit one that has run.
- **Never commit secrets or music.** `.env*`, `local.properties`, keystores and
  audio files stay out of git; `.gitignore` covers the usual ones.
- **Screenshots and examples use invented data,** never a real library.
