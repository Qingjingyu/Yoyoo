# 034 Feature: AI Card Unified Login

## Background

Yoyoo V0.15 allocated its own memorable `AI_` number and authenticated the
single owner with a local password. That made Yoyoo a second identity authority
and could create a different identity from the Card issued by AI Card.

V0.16 changes the boundary: AI Card owns identity creation, permanent Card ID,
credentials and consent. Yoyoo owns only workspace membership, permissions,
rooms, messages, files, tasks and audit. Existing Yoyoo Principal UUIDs remain
unchanged so historical attribution does not move.

## Key Decisions

- Yoyoo never allocates or guesses a Card ID. It accepts `card_id` only from a
  verified AI Card authorization response with the required `card.id` scope.
- External identity is keyed by issuer, client ID and pairwise Subject. Public
  Card ID is a verified display and reconciliation projection, not a login
  secret or Yoyoo foreign key.
- The first owner is linked to the existing Principal only when verified Card ID
  is exactly `AI_100001`; its UUID and all resource ownership stay unchanged.
- Receiving a valid AI Card does not automatically grant access to the owner's
  private Yoyoo workspace. V0.16 rejects uninvited human Cards before creating a
  local Principal; invitations and membership policy remain a later phase.
- Federated browser sessions can exist without a local password credential.
  Password data and the collapsed local form remain only for reversible
  production cutover.
- `/login` has one primary `使用 AI Card 继续` action. AI Card decides whether
  the person creates a new identity or signs into an existing one.
- After a federated login, settings links directly to the authenticated Card
  management page. Yoyoo no longer offers a second "连接我的身份" flow that
  suggests the user needs to register or bind another identity.
- Local development and browser-test mode omit the Card-management link when no
  browser identity provider is configured. Password-mode deployments still
  validate the complete provider configuration and fail closed.
- Safe return paths are encrypted in the transient authorization session and
  must resolve to the same origin. Access tokens are not persisted. The refresh
  grant required for central revocation propagation is persisted only as
  AES-256-GCM ciphertext bound to the one-time authorization-state hash.
- Yoyoo revalidates a federated browser session every five minutes by rotating
  its refresh grant. The idempotency key is a deterministic HMAC of the exact
  old grant and transaction binding, so concurrent requests cannot accidentally
  trigger refresh-token reuse detection with different keys.
- An explicit AI Card rejection revokes the local session and erases its
  ciphertext immediately. A temporary provider outage keeps the last verified
  session for no more than 15 minutes, then denies access without deleting the
  stable Principal mapping.
- Calls to the identity authority have an eight-second network ceiling, so an
  unreachable provider cannot leave a protected Yoyoo request hanging forever.

## Rejected Alternatives

- Using `AI_100001` as a password: it is enumerable and public.
- Copying AI Card credentials into Yoyoo: it would recreate two authorities.
- Replacing Principal UUID foreign keys with Card IDs: it would couple product
  data to a public identifier and require a risky history rewrite.
- Inferring identity from nickname, handle or legacy Card text: none of those is
  cryptographic proof.

## Implementation

- Migration `015` removes local Card allocation and adds authoritative Card ID
  to the verified identity mapping.
- Migration `016` adds `aicard` human sessions bound to an exact identity
  mapping while retaining password sessions for rollback.
- Migration `017` stores only an authorization-state SHA-256 and enforces
  single-use session issuance for each AI Card authorization transaction.
- Migration `018` adds protected refresh material and last-validation metadata.
  It revokes pre-018 federated sessions because they contain no renewable proof;
  password sessions and all Principal/resource relationships remain unchanged.
- Authorization start/callback now support a human-login purpose, strict Card ID
  claims, transactional Principal mapping and federated session issuance.
- Federated readiness checks database availability rather than requiring a
  Yoyoo-local password row, because unified users intentionally have no local
  credential.
- The callback redirects to the configured public origin instead of the
  internal request origin, preserving HTTPS when Yoyoo runs behind a reverse
  proxy.
- The login page exposes the unified entry and visible denied, unavailable,
  invalid-session and identity-conflict states.

## Verification

- TypeScript typecheck: passed.
- ESLint: passed.
- Unit/UI suite: 38 files, 187 tests passed after the final settings, health and network
  timeout regressions were fixed.
- Integration suite: 23 files passed and 5 external-live files skipped; 130
  tests passed and 7 skipped.
- Focused session-authority tests: 22/22 passed, covering encryption binding,
  deterministic concurrent rotation, explicit rejection, outage grace and
  post-revocation ciphertext erasure.
- Forward migration test: `018_aicard_session_authority.sql` applied once on the
  existing `001`-`017` ledger; the second run was checksum-verified and skipped.
- Production build: passed.
- Full local-auth browser regression: 38/38 Playwright checks passed across
  desktop and mobile. This proves the Yoyoo UI regression surface, not a real
  external AI Card authorization exchange.
- Settings identity-entry regression: 14/14 focused configuration/component
  tests and 10/10 focused desktop/mobile browser checks passed. The current Card
  link uses the configured, server-validated AI Card issuer rather than a
  hard-coded domain; an unconfigured local harness no longer crashes the page.
- Refresh request timeout regression: 23/23 focused client, encrypted authority
  and human-session checks passed.
- Cross-repository acceptance is executed from the AI Card repository with
  `npm run test:federation:yoyoo`. It starts isolated PostgreSQL databases and
  real production builds behind temporary HTTPS proxies, then proves first
  registration as `AI_100001`, consent callback, stable owner Principal mapping
  and a second-browser login without a second identity or local credential.

## Remaining Before Production

- Register and verify the formal production issuer, client, scopes and callback.
- Complete the owner authorization, verified backup and rollback rehearsal.
- Run public HTTPS login, history attribution, message/file, logout, anonymous
  denial, health and Agent Gateway acceptance after an approved deployment.

No production configuration or data was changed by this local implementation.
