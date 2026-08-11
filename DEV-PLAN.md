# Yoyoo Space Development Plan

> Version: V0.14 Internal Daily Release
>
> Status: completed and locally verified on 2026-08-11

## Tech Stack

- Node.js 24 and npm 11
- Next.js 16.3, React 19, TypeScript 6
- PostgreSQL 17 through the existing Docker Compose service
- Vitest, ESLint, TypeScript, and Playwright
- Existing local Codex CLI and YOS Web Console adapter

No dependency is added or removed in V0.14.

## Existing Foundations Reused

- `scripts/db-migrate.mjs` for advisory-locked, checksum-verified forward
  migrations.
- `scripts/run-yos-next.mts` for server-side YOS configuration without copying
  credentials into the repository.
- `infra/postgres/docker-compose.yml` for the loopback-only persistent database.
- `.data/blobs` as the default private local BlobStore.
- Existing production build and browser acceptance gates.

## Phase 1: Operations Contract

### Deliverables

- Add tested argument parsing, prerequisite classification, redacted command
  execution, and stable local path resolution.
- Add package scripts for doctor, backup, real internal start, and deterministic
  fallback start.

### Files

- `scripts/internal-ops.mts`
- `tests/scripts/internal-ops.test.ts`
- `package.json`

### Verification

- Unit tests cover invalid modes, required-versus-warning results, safe backup
  destination validation, digest generation, and redacted failures.
- `npm run internal:doctor` reports current machine readiness without writing
  secrets.

## Phase 2: Backup And Verification

### Deliverables

- Start or reuse the existing PostgreSQL container without deleting data.
- Stream a custom PostgreSQL dump to a timestamped directory.
- Archive `.data/blobs`, write a SHA-256 manifest, and verify all artifacts.
- Fail visibly and retain diagnostic context if any artifact is incomplete.

### Files

- `scripts/internal-ops.mts`
- `tests/scripts/internal-ops.test.ts`
- `USAGE.md`

### Verification

- `npm run internal:backup` creates one ignored local backup directory.
- PostgreSQL `pg_restore --list`, `tar -tzf`, and manifest digest verification
  all pass on the generated artifacts.
- The application database and blob source remain unchanged.

## Phase 3: One-Command Internal Start

### Deliverables

- `internal:start` performs prerequisite checks, starts PostgreSQL, applies
  migrations, builds, and launches real Codex + YOS mode on `127.0.0.1:4173`.
- `internal:start:local` performs the same preparation with deterministic Agents.
- Signals stop the foreground application only; persistent database and blob
  storage remain available for the next start.

### Files

- `scripts/internal-ops.mts`
- `package.json`
- `README.md`
- `USAGE.md`

### Verification

- Start the deterministic production release, request homepage and conversation
  routes, stop it, restart it, and confirm the same authoritative room data is
  still returned.
- Run real-mode doctor checks without sending an Agent message.

## Phase 4: Final Gate And Handoff

### Deliverables

- Reconcile status and operating instructions.
- Record exact validation evidence, skipped live checks, remaining risks, and
  the non-automatic restore boundary.

### Files

- `README.md`
- `USAGE.md`
- `开发过程/000_Roadmap.md`
- `开发过程/031_Feature_内部日用版.md`

### Verification

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run db:up`
- `npm run test:integration`
- `npm run build`
- `npm run test:e2e`
- Secret and absolute-path scan over release-owned source and documentation.

## Risks

- A dump without blob bytes is not a complete Yoyoo backup; both artifacts and
  the manifest must verify.
- YOS or Codex may be unavailable while the core application is healthy; doctor
  reports these separately instead of blocking deterministic fallback mode.
- PostgreSQL custom dumps are portable backups, but an actual restore overwrites
  state and therefore remains a separately approved operation.
- Internal loopback readiness is not evidence of public deployment safety.

## Out Of Scope

- Public hosting and production infrastructure.
- Automatic restore or reset.
- Background service installation or operating-system login startup.
- Product features and visual redesign.
