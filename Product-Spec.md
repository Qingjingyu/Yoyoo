# Yoyoo Space Product Spec

> Current version: V0.16 Unified AI Card Identity
>
> Date: 2026-08-13
>
> Status: local implementation and verification complete; production cutover pending

## Goal

Make AI Card the only identity issuer for Yoyoo humans and Agents while keeping
Yoyoo responsible for workspace membership, permissions, rooms, messages,
files, tasks, and audit. Existing Yoyoo history must remain attached to the same
local Principal UUID after the authority migration.

## Target User

- The existing human owner, migrated without changing their Principal UUID.
- Future invited humans who first enter through Yoyoo and automatically receive
  or reuse an authoritative AI Card identity. V0.16 production access remains
  limited to the existing owner until workspace invitations are implemented.
- New AI participants, including YOS instances, already own an authoritative AI
  Card before entering Yoyoo. A human controller explicitly authorizes that
  Card into a workspace; Yoyoo never creates the AI identity locally.
- Existing legacy Gateway Agents continue to authenticate through their current
  credentials for compatibility; they do not receive browser passwords or
  human sessions, and Yoyoo does not issue new local Gateway identities.

## Problem

V0.15 is publicly deployed but still issues local `AI_` numbers and authenticates
the owner with a Yoyoo-only password. This creates a second identity authority:
the same person could receive one identity in Yoyoo and another in AI Card.
Yoyoo must instead accept only a verified AI Card authorization result, map its
pairwise Subject to a stable local Principal UUID, and fail closed when the
identity authority is unavailable.

## MVP Scope

### AI Card identity authority

- AI Card is the only system allowed to create identities or allocate permanent
  `AI_` numbers. Yoyoo never chooses, generates, renumbers, or reuses one.
- Yoyoo stores the authoritative Card ID only as a verified projection for UI
  and reconciliation; it is never a Yoyoo database foreign key or login secret.
- Pairwise AI Card Subject plus issuer and client ID identify the external
  account. Existing Principal UUIDs remain the authoritative Yoyoo foreign keys.
- Display names and handles remain mutable presentation fields synchronized from
  verified AI Card claims.
- The existing owner may be linked to authoritative `AI_100001` only after AI
  Card authentication returns both the expected Card ID and a valid pairwise
  Subject. A matching string in the legacy Yoyoo column is not proof.

### Unified registration and login

- `/login` offers unified AI Card registration and login. Credentials are
  entered and verified by AI Card, not collected or validated by Yoyoo.
- First-time registration from Yoyoo atomically creates the AI Card identity and
  current product authorization. Yoyoo creates a local Principal mapping and
  session only when that identity is allowed into the requested workspace.
- An existing AI Card account reuses the same Card. Yoyoo must not ask the user
  to register or bind another Card.
- AI Card unavailability produces a visible retryable failure. Yoyoo does not
  fall back to local registration, local numbering, or inferred identity.
- V0.15 password credentials remain compatibility data during the reversible
  cutover. The local form is hidden behind an explicitly temporary fallback and
  is removed from the normal path only after production acceptance.

### External AI authorization

- A YOS instance or other external AI must first create and claim its own AI
  Card through the identity authority. That Card remains the AI's permanent
  cross-product identity.
- The workspace owner starts `授权 AI 接入`, selects an AI Card they control,
  and grants it access to the current Yoyoo workspace.
- After a verified callback, Yoyoo creates or reuses only a local Principal,
  workspace membership, permissions, room membership and service mapping. It
  does not mint a second identity, Card number, local handle-based account or
  long-lived `yya_` credential.
- Names and handles are display metadata. Automation and delivery use verified
  AI Card identity mappings plus Yoyoo Principal and room UUIDs.
- Existing `yya_` Gateway Agents remain listable, rotatable and revocable during
  migration, but the browser client and public Agent-creation endpoint cannot
  create another one.

### Browser session and authorization

- A successful AI Card callback creates a cryptographically random Yoyoo session
  bound to the mapped local Principal UUID.
- The browser receives the token only through a `HttpOnly`, `Secure`,
  `SameSite=Lax` cookie; PostgreSQL stores only its SHA-256 hash.
- Sessions have an absolute expiry, can be revoked, and are deleted on logout.
- Federated sessions revalidate their central AI Card grant every five minutes.
  A refresh grant is encrypted at rest with AES-256-GCM, rotated with a stable
  idempotency key, and erased on local logout or authoritative rejection.
- A temporary provider outage may reuse the last verified grant for at most 15
  minutes. After that Yoyoo denies access without deleting the identity mapping,
  so service can recover when AI Card becomes reachable again.
- Every page, browser API, attachment read, and event stream is denied unless a
  valid active human session resolves to the authorized Principal.
- State-changing browser requests validate same-origin metadata. Agent Gateway
  bearer-token routes keep their existing independent authentication.
- Production startup fails closed when AI Card issuer/client/callback settings,
  session secrets, or authoritative owner mapping are missing.

### User experience

- Keep the responsive `/login` page and expose one primary `使用 AI Card 继续`
  action. AI Card decides whether the user signs in or creates an identity, so
  Yoyoo does not present two competing account flows.
- Show loading, provider-unavailable, consent-denied, invalid callback,
  identity-conflict, workspace-access-denied, and success states without
  exposing protocol details or secrets.
- Preserve the requested destination after authentication when it is a safe
  same-origin path.
- Add logout under Settings. Expired sessions return to login without losing
  persisted rooms or drafts.

### Production deployment

- Serve Yoyoo at `https://app.yoyooai.com` behind a TLS reverse proxy.
- Run the Next.js application, PostgreSQL, and private BlobStore on persistent
  storage; bind database and application origins privately.
- Store all credentials in production environment/secrets, never in Git.
- Perform a verified database and BlobStore backup before each deployment.
- Provide health checks, structured redacted logs, deploy verification, and a
  documented rollback to the previous application artifact plus compatible data.
- Start public production without built-in Planner, Builder, or Reviewer demo
  Agents. Real Agents must enter through the existing Agent Gateway or AI Card
  runtime path; local development keeps the deterministic demo seats by default.

## V2 / Later

- Invitations, multi-human workspace administration, and account recovery UX.
- Email or SMS verification and automated password recovery.
- Passkeys, trusted-device management, and user-visible session management.
- Payment, reputation, public profile discovery, and third-party federation.
- Cloud object storage, malware scanning, OCR, semantic search, and external
  notifications.

## Core Flows

1. User opens `app.yoyooai.com` and chooses registration or login.
2. Yoyoo starts an AI Card authorization transaction with PKCE and state. AI
   Card creates or authenticates the identity and obtains explicit consent.
3. Yoyoo verifies the returned token, Subject, Principal type, Card ID, issuer,
   client, and scopes; it maps the identity to a local Principal and creates a
   private server-side session.
4. Server resolves the session to that Principal UUID; all existing room,
   message, file, membership, and audit operations continue using that UUID.
5. User logs out or the session expires; private routes become inaccessible.
6. A YOS or other AI first owns and claims an AI Card; its controller authorizes
   that Card into Yoyoo, which creates only the local workspace projection.
7. Connected Agents use scoped AI Card runtime credentials and exact `room_id`
   delivery without depending on browser auth. Existing `yya_` credentials keep
   working only as migration compatibility.

## Non-Functional Requirements

- Login failures are rate-limited by account and source without leaking account
  existence; repeated failures cause a bounded temporary lock.
- Authentication compares fixed-length hashes in constant-time operations.
- Cookies are never readable by client JavaScript and are secure in production.
- No private response may be cacheable by shared intermediaries.
- Authentication and authorization failures are visible but redact secrets and
  internal database details.
- Forward migrations are immutable and tested from both an empty database and
  the latest released migration ledger.
- Authorization callback identity linking is transactional and concurrency-safe;
  it never maps one AI Card Subject to two Principals or one Principal to two
  AI Card Subjects for the same issuer and client.
- Desktop and mobile login/logout/session-expiry behavior must be browser-tested.

## Acceptance Criteria

- An anonymous request to every private page and browser API is redirected to
  login or rejected with `401`; private bytes and event streams are included.
- The existing owner can log in through AI Card on desktop and mobile, refresh, navigate,
  send a message, and download an authorized file.
- Denied authorization, malformed callbacks, expired/revoked grants or sessions,
  cross-origin mutations, and identity conflicts fail with stable public errors.
- Authoritative `AI_100001` is bound to the existing owner only after verified
  AI Card authentication, without changing historical room,
  message, file, or membership foreign keys.
- Agent Gateway authentication and exact `room_id` delivery remain operational.
- `POST /api/v1/workspaces/current/agents` refuses local identity creation with
  `AI_CARD_REQUIRED`, while Settings exposes only `授权 AI 接入` for new AI.
- A claimed YOS AI Card can be authorized into Yoyoo, maps to one stable local
  Principal on repeated authorization, and can provide service under that
  identity without receiving a second Card or local account.
- A production restart does not recreate built-in demo Agent Principals or room
  memberships when `YOYOO_BUILTIN_AGENTS=none`.
- Backup verification, migration checks, lint, typecheck, unit/integration tests,
  production build, desktop/mobile Playwright, and public HTTPS smoke checks pass.
- Migration reconciliation proves room, message, file, task, membership, and
  audit counts and ownership references are unchanged.

## Not Doing In V0.16

- No Yoyoo-local account creation, password recovery, or AI Card numbering.
- No Yoyoo-local Agent creation, nickname/handle identity matching, or new
  Gateway token issuance through the public UI/API.
- No GitHub, Google, phone, or email login.
- No use of Card ID, handle, nickname, email, or string equality as authorization
  proof; only the verified protocol Subject and claims may establish a mapping.
- No migration from Principal UUID foreign keys to sequential public IDs.
- No direct public exposure of PostgreSQL, BlobStore paths, YOS, or Codex
  credentials.
- No broad production reset, automated restore, historical Principal deletion,
  or rewrite of applied migrations.
- No automatic merge of two existing Cards and no identity guessing from names,
  handles, emails, or legacy IDs.
