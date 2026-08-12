# Public Single-Owner Authentication Implementation Plan

> **For implementation:** execute each task test-first and keep release claims
> separate from local verification.

**Goal:** Make the existing Yoyoo workspace safely usable by its sole owner at
`https://app.yoyooai.com` without changing the current IM data model or Agent
authentication contract.

**Architecture:** Add addressable AI Card IDs and human credentials beside the
existing Principal UUID model. Resolve opaque browser sessions to the existing
owner Principal at the server boundary, then pass that Principal through all
current room/file/message authorization. Deploy the same application behind TLS
with persistent PostgreSQL and BlobStore storage.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 6, Node crypto, PostgreSQL 17,
Vitest, Playwright, containerized production runtime and TLS reverse proxy.

---

## Task 1: Forward Identity And Session Migration

1. Add failing clean-install and `001-012` upgrade-path tests.
2. Add migration `013` with an AI Card sequence, immutable formatted public ID,
   credential, recovery-code, session, and throttling tables.
3. Backfill existing Principals deterministically while preserving every UUID.
4. Run focused migration tests, then the full integration migration gate.

## Task 2: Identity And Authentication Repositories

1. Add failing repository tests for allocation, lookup, provisioning, sessions,
   revocation, expiry, and concurrent behavior.
2. Implement parameterized repository queries and explicit conflict errors.
3. Verify no plaintext password, recovery code, or session token is persisted.

## Task 3: Password And Session Service

1. Add failing tests for validation, versioned `scrypt`, generic failures,
   throttling, recovery codes, expiry, and logout.
2. Implement the minimal service with Node crypto and fixed public errors.
3. Run focused tests and security-oriented boundary cases.

## Task 4: Owner Provisioning Command

1. Add failing command tests using an isolated database and captured output.
2. Implement an idempotent create-only command that binds the existing owner,
   sets its handle/password, and prints one recovery code exactly once.
3. Ensure logs and errors redact credentials and refuse accidental overwrite.

## Task 5: HTTP Authentication And Authorization

1. Inventory public, human-private, and Agent-authenticated routes.
2. Add failing anonymous/authenticated/cross-origin tests for pages, JSON,
   uploads, downloads, and event streams.
3. Implement login/current/logout routes and one central session guard.
4. Replace browser-local owner derivation with the authenticated Principal.
5. Re-run existing Agent Gateway tests to prove its bearer contract is intact.

## Task 6: Login And Logout Interface

1. Add failing component tests for all four states and safe redirect handling.
2. Build the responsive design-token-based login page and Settings logout.
3. Add desktop/mobile Playwright flows for refresh, expiry, logout, keyboard,
   overflow, and console errors.

## Task 7: Production Configuration And Deployment Package

1. Add failing configuration tests for origin, secrets, cookies, storage, and
   private network bindings.
2. Add deterministic container/reverse-proxy files, health endpoint, persistent
   volume contract, and redacted logging.
3. Add backup-before-deploy, artifact identity, smoke, and rollback commands.
4. Verify in a non-production environment before requesting production approval.

## Task 8: Final Gate And Release Evidence

1. Run lint, typecheck, unit, integration, build, Playwright, audit, and secret
   scan gates.
2. Verify the exact release artifact, migration checksums, backup manifests,
   anonymous denial, authenticated desktop/mobile IM, and rollback rehearsal.
3. Update README, USAGE, roadmap, and
   `开发过程/032_Feature_公网单用户登录与部署.md` with exact evidence.
4. Present the verified target host, DNS, backup, rollback, and artifact digest
   before any production mutation.
