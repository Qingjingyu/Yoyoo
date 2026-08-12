# Yoyoo Space Product Spec

> Current version: V0.15 Single-Owner Public Preview
>
> Date: 2026-08-12
>
> Status: approved for implementation

## Goal

Publish the existing Yoyoo IM workspace at `https://app.yoyooai.com` so its
owner can use the same persistent rooms, files, and Agents from desktop and
mobile without exposing private data to anyone else.

## Target User

- One pre-provisioned human owner in V0.15.
- Existing connected Agents continue to authenticate through the Agent Gateway;
  they do not receive browser passwords or human sessions.

## Problem

The current release is intentionally bound to `127.0.0.1` and derives every
human request from `YOYOO_LOCAL_OWNER_ID`. Publishing that process directly
would let an anonymous visitor act as the owner. Yoyoo therefore needs a real
human identity, password authentication, server-side sessions, authorization at
every private HTTP boundary, and a recoverable production deployment.

## MVP Scope

### AI Card identity

- Add one public, permanent `AI Card ID` to every Principal.
- Allocate IDs atomically from `AI_100001` upward across humans and Agents.
- IDs are uppercase, immutable, unique, never reused, and presentation-safe.
- Existing Principal UUIDs remain the authoritative database foreign keys.
- Existing display names and handles remain mutable presentation fields.
- V0.15 pre-provisions the current owner as `AI_100001`; subsequent existing
  Principals receive deterministic ascending IDs during migration.

### Human account

- Add one unique, case-insensitive login handle and a password credential to the
  existing owner Principal.
- Login uses `handle + password`; it never accepts an AI Card ID as a secret.
- Passwords are hashed with a unique salt and Node's built-in `scrypt`;
  plaintext is never stored or logged.
- Account provisioning is an explicit server-side command. There is no public
  registration route.
- The command prints one recovery code exactly once. Only its hash is stored.

### Browser session and authorization

- A successful login creates a cryptographically random opaque session token.
- The browser receives the token only through a `HttpOnly`, `Secure`,
  `SameSite=Lax` cookie; PostgreSQL stores only its SHA-256 hash.
- Sessions have an absolute expiry, can be revoked, and are deleted on logout.
- Every page, browser API, attachment read, and event stream is denied unless a
  valid active human session resolves to the authorized Principal.
- State-changing browser requests validate same-origin metadata. Agent Gateway
  bearer-token routes keep their existing independent authentication.
- Production startup fails closed when required auth secrets or the owner
  account are missing.

### User experience

- Add a responsive `/login` page using the current light/dark optical-glass
  design system.
- Show visible loading, invalid-credential, locked/rate-limited, and success
  states without revealing whether a handle exists.
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

## V2 / Later

- Public registration, invitations, multiple human accounts, and admin UX.
- Email or SMS verification and automated password recovery.
- Passkeys, trusted-device management, and user-visible session management.
- AI Card federation across products, cryptographic card proofs, payment,
  reputation, and public profile discovery.
- Cloud object storage, malware scanning, OCR, semantic search, and external
  notifications.

## Core Flows

1. Maintainer deploys the schema and provisions the owner account once.
2. Owner opens `app.yoyooai.com`, enters handle and password, and receives a
   private server-side session.
3. Server resolves the session to the owner Principal UUID; all existing room,
   message, file, membership, and audit operations continue using that UUID.
4. Owner logs out or the session expires; private routes become inaccessible.
5. Connected Agents continue using scoped Agent Gateway or AI Card runtime
   credentials and exact `room_id` delivery without depending on browser auth.

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
- Desktop and mobile login/logout/session-expiry behavior must be browser-tested.

## Acceptance Criteria

- An anonymous request to every private page and browser API is redirected to
  login or rejected with `401`; private bytes and event streams are included.
- The pre-provisioned owner can log in on desktop and mobile, refresh, navigate,
  send a message, and download an authorized file.
- Wrong passwords, malformed input, expired/revoked sessions, cross-origin
  mutations, and repeated login attempts fail with stable public errors.
- `AI_100001` is bound to the existing owner without changing historical room,
  message, file, or membership foreign keys.
- Agent Gateway authentication and exact `room_id` delivery remain operational.
- Backup verification, migration checks, lint, typecheck, unit/integration tests,
  production build, desktop/mobile Playwright, and public HTTPS smoke checks pass.

## Not Doing In V0.15

- No public account creation or self-service account recovery.
- No GitHub, Google, phone, or email login.
- No use of AI Card ID, handle, nickname, email, or phone as authorization proof.
- No migration from Principal UUID foreign keys to sequential public IDs.
- No direct public exposure of PostgreSQL, BlobStore paths, YOS, or Codex
  credentials.
- No production data deletion, automated restore, or migration rewrite.
