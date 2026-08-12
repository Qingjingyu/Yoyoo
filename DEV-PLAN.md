# Yoyoo V0.15 Public Preview Development Plan

> Status: production deployed on 2026-08-12; approved demo Agent cleanup in
> progress

## Technical Direction

- Keep Next.js 16.3, React 19, TypeScript 6, PostgreSQL 17, Vitest, and
  Playwright.
- Add no authentication dependency. Use Node `crypto.scrypt` for password and
  recovery-code hashing, random opaque session tokens, and database-backed
  revocation.
- Reuse existing Principal UUIDs for all authorization and resource ownership.
- Add a public sequential AI Card ID only as an addressable identity attribute.
- Keep Agent Gateway bearer authentication separate from human web sessions.

## Phase 1: Identity And Credential Schema

### Deliverables

- Forward-only migration for atomic AI Card ID allocation, login credentials,
  human sessions, login-attempt throttling, and recovery-code hashes.
- Deterministic backfill: current owner receives `AI_100001`; remaining
  Principals receive ascending IDs without changing their UUIDs.
- Repository methods for lookup, provisioning, session lifecycle, and revocation.

### Verification

- Write failing migration/repository tests first.
- Test empty install and upgrade from migrations `001` through `012`.
- Prove IDs remain unique under concurrent allocation, are never reused, and
  historical room/message relationships remain unchanged.

## Phase 2: Authentication Domain

### Deliverables

- Password policy and `scrypt` hashing with versioned parameters.
- Opaque session creation, hashed persistence, expiry, rotation, and logout.
- Generic invalid-credential responses and bounded account/source throttling.
- One-time owner provisioning command with redacted output and explicit refusal
  to overwrite an existing credential without a separate rotation operation.

### Verification

- Write failing domain/service tests first.
- Cover correct password, wrong password, Unicode/whitespace rules, constant-size
  public errors, expiry, revocation, duplicate provisioning, and recovery-code
  one-time behavior.

## Phase 3: HTTP Authorization Boundary

### Deliverables

- Login, current-session, and logout endpoints.
- Central human-session guard for private pages and browser APIs.
- Replace browser use of `YOYOO_LOCAL_OWNER_ID` with the authenticated Principal.
- Exempt only health/login assets and existing independently authenticated Agent
  Gateway/runtime endpoints.
- Enforce same-origin checks on authenticated browser mutations and private
  no-store response headers.

### Verification

- Write failing HTTP tests first.
- Inventory every route and prove anonymous denial, owner access, cross-origin
  rejection, private attachment denial, SSE denial, and unaffected Agent Gateway
  bearer authentication.

## Phase 4: Login And Account UX

### Deliverables

- Responsive `/login` experience matching existing light/dark design tokens.
- Loading, invalid, locked, expired, and successful states.
- Safe destination restoration and Settings logout action.
- Session-expiry behavior that preserves server data and local drafts.

### Verification

- Component tests for input, submit, errors, disabled/loading state, and logout.
- Playwright at desktop and mobile widths for login, refresh persistence, logout,
  expiration, keyboard flow, overflow, and console cleanliness.

## Phase 5: Production Packaging

### Deliverables

- Production environment contract and startup validation.
- Container/reverse-proxy deployment files for `app.yoyooai.com`, private
  application/database networking, persistent PostgreSQL and BlobStore volumes,
  TLS, health checks, and redacted logs.
- Backup-before-deploy, artifact identity, smoke-test, and rollback runbook. No
  production mutation runs before target-host and DNS verification.

### Verification

- Configuration tests reject missing secrets, non-HTTPS public origin, default
  passwords, public database binding, and writable ephemeral blob storage.
- Build the exact release artifact, verify backup inventories and digests, then
  test deployment and rollback in a non-production environment.

## Phase 6: Release Gate And Handoff

### Deliverables

- Update README, usage instructions, roadmap, and feature evidence.
- Record confirmed checks separately from skipped real-service or public checks.
- Deploy only after current backup, exact host/DNS ownership, secrets, and
  rollback target have been independently verified.

### Final Gate

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run db:up`
- `npm run test:integration`
- `npm run build`
- `npm run test:e2e`
- Dependency audit and secret scan
- Desktop/mobile HTTPS login and authenticated IM smoke flow
- Anonymous/private-resource denial checks
- Backup verification and rollback rehearsal

## Post-Release Cleanup: Empty Production Workspace

### Deliverables

- Add a validated `YOYOO_BUILTIN_AGENTS=none` production mode while preserving
  the existing local demo default.
- Deploy the new runtime before removing the three known demo Agent Principals,
  their bindings, and memberships by exact ID.
- Keep the owner account, workspace, empty collaboration room, legacy homepage
  conversation, sessions, and production volumes intact.
- Record a pre-cleanup PostgreSQL and BlobStore backup and retain the previous
  application image for rollback.

### Verification

- Prove the disabled seed mode is empty and rejects unsupported values.
- Verify the backup manifest, PostgreSQL dump inventory, and BlobStore archive.
- After deletion and an application restart, verify two Principals remain
  (`AI_100001` owner and the system Principal), zero Agent Principals remain,
  the collaboration room remains accessible, and public login still succeeds.

## Primary Risks

- A decorative login page without API authorization would expose all private
  data; route inventory and negative tests are mandatory.
- Sequential AI Card IDs are enumerable; they must never grant access or reveal
  private profile data by themselves.
- Production sessions can become unrecoverable if secrets rotate without a
  planned logout; rotation must be versioned and documented.
- Local BlobStore data is not durable on ephemeral hosting; deployment must use
  verified persistent storage before file features are accepted.
- Agent runtimes may live outside the public server. Gateway reachability and
  secrets must be configured independently from browser authentication.

## Rejected Alternatives

- GitHub OAuth: secure but unnecessarily inconvenient on mobile for the first
  owner-only release.
- Email/SMS codes: add delivery vendors, cost, and failure modes before they are
  needed.
- AI Card ID as the login secret: memorable but enumerable and therefore unsafe.
- Stateless long-lived signed cookies only: simpler, but weakens immediate
  revocation and session audit.
