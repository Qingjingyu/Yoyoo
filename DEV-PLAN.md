# Yoyoo V0.19 Product Consistency Development Plan

> Status: V0.18 production remains active; V0.19 local implementation and
> verification are complete, production release is pending a separate gate

## Phase 8D: V0.19 Product Consistency Closure

### Deliverables

- Replace the homepage `current conversation` client with the authenticated
  room client and route every message through an explicit `room_id`.
- Remove browser dependence on `YOYOO_LOCAL_OWNER_ID` and retire the obsolete
  homepage conversation surface after migration coverage is green.
- Read the current display name and AI Card projection from the authenticated
  session; calculate greetings at runtime and attribute interventions to the
  authenticated human Principal.
- Render `我的 AI Card` inside Settings with loading, empty, error, and success
  states. Keep issuer URLs out of visible product navigation.
- Restructure Settings into Identity, Appearance, and AI Access sections with a
  single Agent authorization action.
- Hide preview-only Live entry in production and make development previews
  explicitly non-functional.
- Add route-correct error/not-found handling and fence isolated motion previews
  from production navigation.

### Verification

- Write failing UI and HTTP tests before each behavior change.
- Prove the homepage sends to the selected canonical room and the message is
  visible in the room IM without a second conversation store.
- Prove two different authenticated display names render and attribute actions
  correctly; no user-facing source contains the literal owner name.
- Prove `我的 AI Card` opens in Yoyoo without an external navigation and handles
  missing session data visibly.
- Prove production mode exposes no functional microphone claim or preview route.
- Run lint, typecheck, full unit/UI tests, PostgreSQL integration tests, the
  production build, and desktop/mobile browser checks before completion.

### Rejected Alternative

- Patching only the `我的 AI Card` link is smaller but leaves the duplicate
  conversation model, hard-coded identity, and simulated voice contract intact;
  those shared assumptions would continue to produce the same class of defect.

## Phase 8C-6: AI Card-only Authority Finalization

### Deliverables

- Add an explicit `aicard` human-auth mode that keeps federated session refresh,
  authorization and logout while disabling the Yoyoo-local password endpoint.
- Make production packaging default to AI Card-only mode; keep `password` only
  as an explicitly configured rollback mode.
- Add forward migration `019` to release only the obsolete legacy Card-ID
  immutability trigger. Do not mutate identity data inside the migration.
- Add a report-only-by-default finalization command. It may apply only after one
  active Owner, the verified `AI_100001` mapping, and an unexpired AI Card
  session are all proven in one transaction.
- On explicit apply, revoke password sessions, disable rather than delete the
  legacy credential, and clear local Principal Card projections without
  changing Principal UUIDs or business foreign keys.

### Verification

- Unit tests prove production configuration, conditional public routes, and the
  retired password endpoint.
- Isolated PostgreSQL tests prove missing authority evidence causes zero
  mutation, dry-run is read-only, repeated apply is safe, the AI Card session
  remains active, and owner/workspace/room/mapping relationships are preserved.
- Production remains a separate gate: backup, real Owner login, dry-run report,
  public smoke checks, and a new explicit approval are required before apply.

## Technical Direction

- Keep Next.js 16.3, React 19, TypeScript 6, PostgreSQL 17, Vitest, and
  Playwright.
- Add no authentication dependency. Use Node `crypto.scrypt` for password and
  recovery-code hashing, random opaque session tokens, and database-backed
  revocation.
- Reuse existing Principal UUIDs for all authorization and resource ownership.
- Store the public sequential AI Card ID only as a verified addressable identity
  projection. Yoyoo never allocates it.
- Keep Agent Gateway bearer authentication separate from human web sessions.
- Reuse the existing AI Card authorization-code, PKCE, pairwise Subject, and
  runtime-token implementation. Do not create a second federation protocol.
- Add only forward migrations. Migrations `001` through `014` remain byte-for-byte
  immutable because production has already applied them.

## Phase 8C-1: Authority Migration Contract

### Deliverables

- Forward migration removes the Yoyoo allocation trigger and default while
  retaining legacy `ai_card_id` values as compatibility projections.
- Identity mappings persist the authoritative Card ID returned with the verified
  issuer, client ID, pairwise Subject, and last verification time.
- New Yoyoo Principals can only be created from a verified AI Card result; the
  existing owner is linked to the current Principal UUID only when the returned
  Card ID is exactly the expected migration identity.
- Existing rooms, messages, files, tasks, memberships, Agent bindings, and audit
  records continue to reference their current Principal UUIDs.

### Verification

- Write migration-upgrade tests from the exact released `001`-`014` ledger and
  from an empty schema before implementation.
- Snapshot counts and representative ownership foreign keys before migration and
  assert byte-for-byte identity after migration.
- Prove direct Principal insertion without a verified Card ID no longer receives
  a locally generated `AI_` number.

## Phase 8C-2: Federated Human Session

### Deliverables

- Extend the existing callback to validate Subject, Principal type, scopes, and
  authoritative Card ID, then transactionally map the Principal and create a
  revocable Yoyoo session.
- Generalize Yoyoo sessions so federated sessions do not require an active local
  password credential. Keep local credential/session tables readable for rollback.
- Persist only AES-256-GCM protected refresh material, rotate it every five
  minutes with a deterministic idempotency key, and propagate authoritative
  grant rejection to the local session. Keep a bounded 15-minute availability
  grace without turning provider downtime into permanent identity deletion.
- Make authorization start and callback public paths while keeping state, PKCE,
  callback cookie, safe return path, no-store, and same-origin protections.
- Fail closed when AI Card is unavailable, claims conflict, or the current owner
  has not completed the explicit migration link.

### Verification

- Unit tests cover valid callback, denied consent, bad state, Subject mismatch,
  Card ID mismatch, wrong Principal type, missing scope, replay, and unavailable
  issuer.
- Integration tests prove the same verified Subject returns the same Principal,
  concurrent callback is idempotent, and conflicting mappings are rejected.
- Session tests prove refresh, logout, expiry, revocation, and private-route
  enforcement without a local password credential.

## Phase 8C-3: Unified Entry UX

### Deliverables

- Replace the external `使用 AI Card 继续` hop with a Yoyoo-native segmented
  login/create surface built entirely from existing semantic design tokens.
- Keep credentials out of Yoyoo by sending them from the browser only to an
  exact allowlisted AI Card origin. Resolve the existing authorization request
  through AI Card's host-only session, CSRF, PKCE, and state controls.
- Remove the temporary local-password fallback from the public entry after the
  embedded path passes production acceptance; retain data only for rollback.
- Preserve a validated same-origin destination across the federation round trip.
- Add loading, denied, unavailable, invalid-session, identity-conflict,
  workspace-access-denied, and success states.
- Show the current verified Card directly in Yoyoo; do not ask the user to bind or
  register it again.
- Keep V0.16 workspace admission owner-only. A valid but uninvited Card receives
  an explicit access-denied state and never creates a Yoyoo Principal.

### Verification

- Component and Playwright tests cover desktop/mobile, keyboard focus, overflow,
  retry, registration, existing-account login, callback, session persistence,
  and logout.
- A second reference product resolves the same Card to a different pairwise
  Subject without creating another Card.

## Phase 8C-4: Cutover And Rollback

### Deliverables

- Produce read-only inventory, verified PostgreSQL and BlobStore backup, mapping
  reconciliation report, exact release artifact, and previous-image rollback.
- Deploy schema/application additively, complete the owner AI Card link, verify it,
  then disable the normal local-password entry. Do not delete legacy credentials.
- Keep Agent Gateway compatibility and current exact `room_id` delivery unchanged.

### Verification

- Local lint, typecheck, unit, integration, build, and desktop/mobile E2E pass.
- Staging rehearses forward migration and application rollback against a copy of
  the released ledger.
- Production cutover requires a new explicit approval after backup and rollback
  evidence. Public real login, history attribution, message/file operations,
  logout, anonymous denial, health, and Agent Gateway smoke checks must pass.

## Phase 8C-5: AI Card Only Agent Admission

### Deliverables

- Remove local Agent creation from the Settings client and expose one
  `授权 AI 接入` path for YOS and other external AI identities that already own
  an AI Card.
- Make the former public Agent-creation POST fail visibly with
  `AI_CARD_REQUIRED` and no database mutation.
- Preserve listing, credential rotation and revocation for already-connected
  legacy `yya_` Agents until a separate migration is approved.
- Keep internal legacy Agent fixtures only for protocol regression tests; they
  are not a product admission path.

### Verification

- Component and desktop/mobile browser tests prove there is no local display
  name, handle or credential-creation form and that both normal and empty states
  route to AI Card authorization.
- HTTP integration proves a local creation request returns `409`, does not add
  the requested handle, and existing Gateway protocol tests still pass through
  explicitly internal compatibility fixtures.
- Cross-repository acceptance proves a claimed YOS AI Card maps to one stable
  Yoyoo Principal and can serve an authorized room without a second identity.

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
- Mapping the legacy `AI_100001` string without a verified AI Card Subject would
  allow account takeover; migration linkage must require a successful authority
  callback and exact expected Card claim.
- Disabling local login before a verified federated owner session would lock out
  production; the cutover remains additive and reversible until acceptance.

## Rejected Alternatives

- GitHub OAuth: secure but unnecessarily inconvenient on mobile for the first
  owner-only release.
- Email/SMS codes: add delivery vendors, cost, and failure modes before they are
  needed.
- AI Card ID as the login secret: memorable but enumerable and therefore unsafe.
- Stateless long-lived signed cookies only: simpler, but weakens immediate
  revocation and session audit.
- Copying AI Card accounts into Yoyoo: keeps login locally available but creates
  a second credential authority and violates the unified-account requirement.
- Replacing Yoyoo Principal UUIDs with AI Card IDs: appears simpler but would
  rewrite every resource relationship and expose an enumerable public ID as an
  internal ownership key.
