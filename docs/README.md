# MusicVault — Documentation Index

Two sets of documents live in this repository:

- **`docs/`** (this folder) — the project's own working documentation, written alongside the code.
- **`reports/`** — a full audit generated on **2026-07-17** against `main` @ `e3b5237`, grounded in
  the files it cites, and brought up to date for the vault (Google Drive's replacement) on
  2026-10-13.

---

## Start here

| If you want to… | Read |
|---|---|
| Understand what this project is | [reports/PROJECT_OVERVIEW.md](../reports/PROJECT_OVERVIEW.md) |
| Get it running | [reports/BUILD_AND_RUN.md](../reports/BUILD_AND_RUN.md) → [setup.md](setup.md) |
| Find your way around the code | [reports/REPOSITORY_STRUCTURE.md](../reports/REPOSITORY_STRUCTURE.md) |
| Contribute a change | [reports/DEVELOPER_GUIDE.md](../reports/DEVELOPER_GUIDE.md) |
| Know why it's built this way | [reports/ARCHITECTURE_DECISIONS.md](../reports/ARCHITECTURE_DECISIONS.md) |
| Fix something that's broken | [reports/TROUBLESHOOTING.md](../reports/TROUBLESHOOTING.md) |

---

## Audit documents (`reports/`)

### Orientation
| Document | What's in it |
|---|---|
| [PROJECT_OVERVIEW.md](../reports/PROJECT_OVERVIEW.md) | What the project is, architecture, data flow, storage providers, implementation status, technologies. Mermaid diagrams. |
| [REPOSITORY_STRUCTURE.md](../reports/REPOSITORY_STRUCTURE.md) | Every folder and package walked through, with what each does. |
| [FEATURES.md](../reports/FEATURES.md) | Feature inventory by domain — purpose, status, files, dependencies, platform support. Cited per claim. |
| [FEATURE_PARITY.md](../reports/FEATURE_PARITY.md) | Desktop / Android / Web matrix, every gap explained in user-visible terms, plus 10 **silent divergences**. |

### Reference
| Document | What's in it |
|---|---|
| [DATABASE.md](../reports/DATABASE.md) | Supabase PostgreSQL, desktop SQLite, Android Room, web IndexedDB/OPFS — every table, column, migration and version. ER diagrams. |
| [API.md](../reports/API.md) | The Tauri commands, the `@musicvault/core` API, Android repositories, Supabase and vault interactions. |
| [VAULT.md](../reports/VAULT.md) | The private R2 bucket, the `vault` Edge Function, uploads, online editing, deletes, downloads and caching per platform. |
| [ENVIRONMENT_VARIABLES.md](../reports/ENVIRONMENT_VARIABLES.md) | Every variable, where it's read, required or not, and its security posture. |

### Process
| Document | What's in it |
|---|---|
| [BUILD_AND_RUN.md](../reports/BUILD_AND_RUN.md) | Prerequisites, per-platform commands, debug vs release, Supabase, the vault, CI/CD. |
| [TESTING.md](../reports/TESTING.md) | The four suites, the golden-fixture strategy, coverage reality, how to add tests. |
| [TROUBLESHOOTING.md](../reports/TROUBLESHOOTING.md) | Known failures across Android, Gradle, Supabase, the vault, Tauri, Rust, Node, Vercel and Windows. |
| [DEVELOPER_GUIDE.md](../reports/DEVELOPER_GUIDE.md) | Philosophy, conventions, and how to add commands, rules, ops, migrations and screens. |

### History & direction
| Document | What's in it |
|---|---|
| [PHASE_PROGRESS.md](../reports/PHASE_PROGRESS.md) | Phases 0–9 and the vault migration, with remaining work. |
| [CHANGELOG.md](../reports/CHANGELOG.md) | Release-style history generated from 45 commits, plus a schema-version table. |
| [ARCHITECTURE_DECISIONS.md](../reports/ARCHITECTURE_DECISIONS.md) | 18 ADRs with quoted rationale; speculation flagged as such. |
| [ROADMAP.md](../reports/ROADMAP.md) | Completed / In Progress / Not Started / Future Ideas, with dependencies. |

---

## Project documentation (`docs/`)

| Document | What's in it |
|---|---|
| [architecture.md](architecture.md) | The architecture and its principles, with per-phase design notes. |
| [sync-protocol.md](sync-protocol.md) | The sync wire protocol, conflict rules, and diagnostics. |
| [setup.md](setup.md) | Zero-to-running walkthrough for all three apps. |
| [setup-supabase.md](setup-supabase.md) | Creating the Supabase project and applying migrations. |
| [web-setup.md](web-setup.md) | Web env, local dev, Vercel deployment. |
| [vault-setup.md](vault-setup.md) | Creating the private R2 bucket, its API token and CORS policy, the Supabase secrets, and deploying the `vault` function. |
| [drive-to-r2-migration.md](drive-to-r2-migration.md) | The record of how Google Drive was replaced by the vault (complete). |
| [fixtures/smart-rules.golden.json](fixtures/smart-rules.golden.json) | ⚠️ **Not documentation** — the golden fixture pinning the TypeScript and Kotlin rule engines. |
| [fixtures/stats.golden.json](fixtures/stats.golden.json) | ⚠️ **Not documentation** — the golden fixture pinning both stats engines. |
| [fixtures/track-edit.golden.json](fixtures/track-edit.golden.json) | ⚠️ **Not documentation** — the golden fixture pinning field-level track edits (SQL, TypeScript, Kotlin). |

Also at the repository root: [README.md](../README.md) (entry point + phase checklist) and
[PLAN.md](../PLAN.md) (the original phases 0–9 build plan).

---

## Reading paths

**New contributor**
[PROJECT_OVERVIEW](../reports/PROJECT_OVERVIEW.md) → [REPOSITORY_STRUCTURE](../reports/REPOSITORY_STRUCTURE.md) →
[BUILD_AND_RUN](../reports/BUILD_AND_RUN.md) → [DEVELOPER_GUIDE](../reports/DEVELOPER_GUIDE.md) →
[ARCHITECTURE_DECISIONS](../reports/ARCHITECTURE_DECISIONS.md)

**Working on sync**
[architecture.md](architecture.md) → [sync-protocol.md](sync-protocol.md) →
[API § sync engine](../reports/API.md#24-sync-engine---sync) → [DATABASE](../reports/DATABASE.md) →
[TESTING § conflict suite](../reports/TESTING.md#the-sync-engine-suite-765-lines-is-the-crown-jewel)

**Working on the vault (uploads, editing, downloads)**
[VAULT](../reports/VAULT.md) → [vault-setup.md](vault-setup.md) →
[architecture.md § The vault](architecture.md#the-vault-audio-and-covers) → [DATABASE](../reports/DATABASE.md)

**Closing a platform gap**
[FEATURE_PARITY](../reports/FEATURE_PARITY.md) → [FEATURES](../reports/FEATURES.md) →
[ROADMAP](../reports/ROADMAP.md) → [DEVELOPER_GUIDE](../reports/DEVELOPER_GUIDE.md)

---

## Three things worth knowing up front

1. **Change shared semantics in lockstep or not at all.** `smartRules.ts`, `stats.ts` and
   `trackFields.ts` (track edits) have hand-written Kotlin ports, and track edits a SQL one too; the
   fixtures in `docs/fixtures/` are the only thing preventing silent cross-device divergence. ([DEVELOPER_GUIDE](../reports/DEVELOPER_GUIDE.md#the-one-rule-that-matters-most))
2. **One documented abstraction does not exist.** `architecture.md` and `PLAN.md` describe an audio
   **output trait** that WASAPI-Exclusive/ASIO backends would slot into. It is not in the code — that
   roadmap item begins with an extraction.
   ([ADR-011](../reports/ARCHITECTURE_DECISIONS.md#adr-011-replaceable-components-aspirational-in-two-places))
3. **Parity is maintained by intent, not by CI.** Nothing checks that a feature exists on all three
   clients; ten features already behave differently across platforms.
   ([FEATURE_PARITY § silent divergences](../reports/FEATURE_PARITY.md#silent-divergences))

---

*Audit generated 2026-07-17 · `main` @ `e3b5237` · 45 commits · 450 tracked files.*
