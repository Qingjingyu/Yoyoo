# Yoyoo Space V0.9 / IM-1 Development Plan

> Status: approved implementation plan on 2026-08-10

## Delivery Objective

Deliver a daily-usable IM resource loop without replacing the existing room or
Agent runtime: private upload, message attachment, safe preview/download,
explicit Agent file access, history/search, message revision, unread/draft state,
and stable human/Agent direct rooms.

Each phase below must remain runnable, independently testable, and reversible by
disabling its new route/UI entry while preserving already-written data. No phase
may rewrite migrations `001` through `006` or serve binary files from `public/`.

## Tech Stack And Reuse

- Reuse Next.js 16 Route Handlers, React 19, TypeScript 6, Zod 4, PostgreSQL 17,
  Vitest 4, Playwright 1.62, current Principal/membership rules, room service,
  idempotency ledger, Agent contracts, Gateway, AI Card runtime, and details pane.
- Use Node streams and `crypto` SHA-256 behind a small `BlobStore` server
  interface. The first implementation uses a configured private local root and
  opaque object keys; no new runtime dependency or storage SDK.
- Use bounded PostgreSQL substring search for visible message text and filenames
  in V0.9. Document parsing, OCR, vectors, and a search service remain excluded.
- Use forward-only `007_im_resources.sql`; empty and upgrade-path tests must
  prove migrations `001` through `006` retain their current checksums.

## Phase 1: Private Resource And Permission Foundation

### Deliverables

- Add attachment, message-attachment, pending-upload, and Agent resource-grant
  records with workspace, room, Principal, checksum, media, size, status,
  provenance, and cleanup timestamps.
- Add `BlobStore`, private local streaming storage, opaque object-key creation,
  SHA-256 computation, size limits, safe media classification, range reads, and
  idempotent cleanup of expired unattached uploads.
- Add repository/service authorization for upload ownership, atomic message
  linkage, room-member preview/download, and deny-by-default resource reads.
- Keep physical paths and object keys out of browser-visible domain records.

### Likely Files

- `infra/postgres/migrations/007_im_resources.sql` (new)
- `src/domain/collaboration.ts`
- `src/server/blob-store.ts` (new)
- `src/server/local-blob-store.ts` (new)
- `src/server/attachment-service.ts` (new)
- `src/server/postgres/attachment-repository.ts` (new)
- `src/server/postgres/room-repository.ts`
- `src/server/runtime.ts`
- `tests/integration/collaboration-migration.test.ts`
- `tests/integration/attachment-repository.test.ts` (new)
- `tests/attachments/blob-store.test.ts` (new)

### Verification

- RED/GREEN tests for empty/upgrade migration, immutable prior checksums, hash and
  metadata persistence, path traversal, ownership, cross-room/workspace denial,
  idempotent link, duplicate upload, range read, oversize/blocked type,
  interrupted stream, cleanup, and no physical-path leakage.
- Run `npm run db:up`, `npm run db:migrate`, `npm run typecheck`, `npm test`, and
  `npm run test:integration`.

## Phase 2: Upload, Composer, Preview, And Download

### Deliverables

- Add authenticated upload, attachment metadata, preview, and download routes
  with stable validation and public errors.
- Add composer selection and real upload progress for up to 10 files, optional
  text, removal before send, partial failure, retry, and atomic final send.
- Render inline image/PDF/safe-text preview and a compact download row for office,
  ZIP, and generic accepted files. Keep long filenames and narrow viewports safe.
- Add file entries to existing room messages without nesting decorative cards or
  changing the accepted homepage.

### Likely Files

- `src/app/api/v1/attachments/route.ts` (new)
- `src/app/api/v1/attachments/[attachmentId]/route.ts` (new)
- `src/app/api/v1/attachments/[attachmentId]/content/route.ts` (new)
- `src/app/api/v1/rooms/[roomId]/messages/route.ts`
- `src/lib/attachment-client.ts` (new)
- `src/lib/room-client.ts`
- `src/components/conversation/attachment-composer.tsx` (new)
- `src/components/conversation/attachment-view.tsx` (new)
- `src/components/conversation/collaboration-room.tsx`
- `src/styles/conversation.css`
- `tests/integration/attachment-http.test.ts` (new)
- `tests/ui/attachment-client.test.ts` (new)
- `tests/ui/attachment-composer.test.tsx` (new)
- `tests/ui/collaboration-room.test.tsx`
- `e2e/im-attachments.spec.ts` (new)

### Verification

- API tests cover authenticated upload, invalid/oversize/interrupted content,
  optional-text send, atomic attachment link, safe headers, range content,
  archived room, removed member, and no duplicate link/message on retry.
- UI and browser tests cover empty/loading/uploading/processing/ready/partial-
  failure/retry/permission-denied states, long filenames, keyboard use, refresh,
  image/PDF/text preview, download, `1440x900`, and `390x844`.
- Run lint, typecheck, unit/UI, integration, build, and the targeted Playwright
  attachment suite before the phase is accepted.

## Phase 3: Provider-Neutral Agent Attachment Access

### Deliverables

- Extend the general Agent run contract with immutable attachment descriptors
  containing stable IDs, safe metadata, provenance, and an authenticated
  resource reference, never local paths or permanent public URLs.
- Add a runtime resource route that verifies current Agent identity/session,
  node/Grant validity, workspace and room membership, target run, and attachment
  scope for every request.
- Extend Gateway, AI Card Gateway, Codex, and YOS adapter boundaries through one
  capability-declared contract. An unsupported adapter returns a visible bounded
  degradation instead of silently dropping files.
- Persist Agent-produced downloadable resources through the Phase 1 attachment
  service with producer and source-run provenance.

### Likely Files

- `src/agents/contract.ts`
- `src/agents/agent-gateway-adapter.ts`
- `src/agents/codex-cli-adapter.ts`
- `src/agents/yos-adapter.ts`
- `src/server/collaboration-service.ts`
- `src/server/collaboration-run-coordinator.ts`
- `src/server/agent-gateway-service.ts`
- `src/app/api/v1/agent-gateway/resources/[attachmentId]/route.ts` (new)
- `scripts/agent-gateway-client.mts`
- `scripts/run-aicard-yos-gateway-agent.mts`
- `tests/agents/contract.test.ts`
- `tests/agents/agent-gateway-adapter.test.ts`
- `tests/integration/agent-attachment-access.test.ts` (new)
- `tests/integration/yos-agent-gateway-live.test.ts`

### Verification

- Contract and integration tests prove mentioned-only descriptor delivery,
  unsupported capability failure, authenticated streaming read, cross-Agent and
  cross-run denial, room removal, token/session expiry, node/Grant revocation,
  duplicate produced-resource idempotency, and absence of path/token leakage.
- Explicit gated live acceptance sends one uniquely marked file to a real YOS
  Agent, persists one answer based on it, and verifies refresh recovery.
- Run the full existing Agent/Gateway/AI Card regression gate in addition to the
  Phase 3 tests.

## Phase 4: Room Files And Authorized Search

### Deliverables

- Add bounded, paginated search over authorized visible message text and
  attachment filenames with room, sender, type, and date filters.
- Add a `Files` section in the existing room-details pane, grouped into images,
  documents, archives, and Agent-produced resources.
- Add source-message navigation that selects the room, loads the correct history
  window, focuses the message, and exposes no inaccessible count or snippet.
- Keep global search inside the conversation surface; do not add a homepage
  dashboard or separate file-manager product.

### Likely Files

- `src/server/postgres/search-repository.ts` (new)
- `src/server/search-service.ts` (new)
- `src/app/api/v1/search/route.ts` (new)
- `src/app/api/v1/rooms/[roomId]/files/route.ts` (new)
- `src/lib/search-client.ts` (new)
- `src/components/conversation/conversation-search.tsx` (new)
- `src/components/conversation/room-files.tsx` (new)
- `src/components/conversation/collaboration-room.tsx`
- `src/styles/conversation.css`
- `tests/integration/search-http.test.ts` (new)
- `tests/ui/conversation-search.test.tsx` (new)
- `e2e/im-search.spec.ts` (new)

### Verification

- Repository/HTTP tests prove permission filtering before totals, deterministic
  pagination, text/filename matching, every filter, archived-room read access,
  removed-member denial, long query bounds, and no cross-workspace leakage.
- Browser tests prove empty/loading/error/results, source navigation, room-file
  filters, browser back/forward behavior, keyboard operation, and narrow layout.

## Phase 5: Message Revisions, Retraction, And Reply Completion

### Deliverables

- Add append-only message revisions for current-user edits and retractions.
- Preserve sender, room, original audit fact, mentions, attachment links, runs,
  and historical provenance. Current room/search/Agent reads use the visible
  revision; retracted content is not included in future Agent context.
- Complete reply/quote display and navigation and add copy/edit/retract actions
  using compact menus and confirmations appropriate to consequence.
- Reject edit/retract from another member, archived room, system message, active
  execution conflict, or stale revision with stable visible errors.

### Likely Files

- `infra/postgres/migrations/010_message_revisions.sql` (new)
- `src/domain/collaboration.ts`
- `src/server/postgres/room-repository.ts`
- `src/server/collaboration-service.ts`
- `src/app/api/v1/rooms/[roomId]/messages/[messageId]/route.ts` (new)
- `src/lib/room-client.ts`
- `src/components/conversation/message-actions.tsx` (new)
- `src/components/conversation/collaboration-room.tsx`
- `tests/integration/collaboration-migration.test.ts`
- `tests/integration/message-revisions.test.ts` (new)
- `tests/ui/collaboration-room.test.tsx`
- `e2e/im-message-actions.spec.ts` (new)

### Verification

- Test first for authorization, monotonic revision, stale conflict, idempotent
  retry, archived/system/other-member denial, search update, retracted Agent
  context exclusion, attachment preservation, source reply navigation, refresh,
  and audit retention.
- Re-run empty and production-baseline migration paths because Phase 5 adds a
  second forward-only migration.

## Phase 6: Unread, Drafts, Reading Position, And Direct Rooms

### Deliverables

- Add monotonic per-member read cursors, deterministic unread room summaries,
  and one revisioned private draft per member/room.
- Restore room draft and reading position, protect a newer draft from stale save,
  and clear only the submitted draft revision after successful send.
- Add stable direct rooms between the current human and one Agent while reusing
  current room membership, messages, attachments, runs, details, and archive.
- Polish combined room rail, timeline, composer, search, files, unread, and Agent
  states without changing the homepage.

### Likely Files

- `infra/postgres/migrations/011_im_member_state.sql` (new)
- `src/domain/collaboration.ts`
- `src/server/postgres/room-repository.ts`
- `src/server/postgres/member-state-repository.ts` (new)
- `src/server/collaboration-service.ts`
- `src/app/api/v1/rooms/[roomId]/read/route.ts` (new)
- `src/app/api/v1/rooms/[roomId]/draft/route.ts` (new)
- `src/app/api/v1/direct-rooms/route.ts` (new)
- `src/lib/room-client.ts`
- `src/components/conversation/collaboration-room.tsx`
- `src/styles/conversation.css`
- `tests/integration/member-state-http.test.ts` (new)
- `tests/ui/collaboration-room.test.tsx`
- `e2e/im-daily-use.spec.ts` (new)

### Verification

- Tests prove monotonic read cursor, deterministic unread counts, idempotent and
  revision-safe draft writes, successful-send clear, failed-send preservation,
  room isolation, archived behavior, and unique active direct pair.
- Full browser acceptance covers refresh, room switch, offline/reconnect, unread,
  jump-to-latest, draft recovery, direct/group room continuity, file/search/
  message actions, mobile overflow, loading/empty/error/success, and zero console
  errors.

## Final Gate And Handoff

- Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run db:up`,
  `npm run test:integration`, `npm run build`, and `npm run test:e2e`.
- Run empty-database migration plus upgrade from the current migration ledger;
  compare applied migration checksums before accepting the release.
- Run one real authenticated Gateway Agent + Yoyoo + YOS file round trip, revoke
  that Agent credential, and prove the next file request is denied. Re-run the
  AI Card runtime authorization/revocation suite on the same attachment contract.
- Inspect desktop/mobile screenshots, browser console, upload/download memory
  behavior, file cleanup, authorization failures, and restart recovery.
- Update `README.md`, `开发过程/000_Roadmap.md`, and one feature record per
  accepted phase. Do not claim production readiness without the separate AI Card
  security/recovery and deployment gates.

## Main Risks And Controls

- **File access leakage:** opaque object keys plus authorization on metadata and
  every byte read; never rely on URLs, filenames, paths, or UI hiding.
- **Memory or disk exhaustion:** streaming I/O, hard server limits, pending
  cleanup, bounded concurrency, and visible retry rather than buffering.
- **Type confusion and active content:** detected-type validation, executable
  rejection, download disposition, explicit safe-preview allowlist, and no file
  execution by Yoyoo.
- **Agent privilege widening:** run-scoped, short-lived resource authorization
  rechecked against current identity, node/Grant, membership, and room facts.
- **Search leakage:** authorization joins occur before snippets, totals, filters,
  and pagination.
- **History corruption:** append-only revisions, soft retraction, stable IDs, and
  existing attribution/resources/runs preserved.
- **Unread/draft races:** monotonic cursors, draft revisions, idempotency, and
  server-authoritative reconciliation.
- **Scope explosion:** document-body search, multi-human notifications, voice,
  cloud drives, public links, and collaboration editing stay out of V0.9.

## Rejected Alternatives

- **Add only an upload button:** rejected because storage, permission, Agent
  access, history, search, revocation, retry, and audit would remain disconnected.
- **Store files in `public/` or permanent signed URLs:** rejected because URL
  possession would bypass current room and identity revocation.
- **Embed all file bytes in messages or PostgreSQL rows:** rejected because it
  couples message reads to binary size and blocks streaming/object-store growth.
- **Clone all Slack/Feishu features before use:** rejected because it delays the
  smallest daily-use loop and adds multi-human semantics not yet visible in V0.9.
- **Let Yoyoo parse files into answers:** rejected because understanding and
  reasoning belong to each connected Agent, not the collaboration platform.

## Out Of Scope

- Homepage redesign, public deployment, multi-human registration/invitation,
  external push, human presence/typing, document-body/OCR/semantic search,
  knowledge base, cloud-drive sync, public links, online document editing,
  voice/video, social feed, calendar, approval, payment, marketplace, and hard
  deletion.

# Delivered V0.8 Development Plan Reference

> Status: proposed implementation plan on 2026-08-08

## Delivery Objective

Close the first external-Agent loop without replacing the existing collaboration
runtime: create a durable Agent identity and credential, connect a separate
process over a versioned pull-based HTTPS protocol, route one existing room run
through a shared Gateway Adapter, and persist its terminal response.

## Tech Stack

- Existing Next.js 16 Route Handlers, React 19, TypeScript 6, Zod 4, PostgreSQL
  17, Vitest 4, and Playwright 1.62.
- Node `crypto` for 256-bit random credentials and SHA-256 lookup hashes.
- PostgreSQL durable jobs and leases; no WebSocket server and no new dependency.

## Phase 1: Credential And Delivery Foundation

### Deliverables

- Add forward-only migration `004_agent_gateway.sql` with Agent credentials,
  heartbeat state, durable jobs, lease ownership, terminal result, and indexes.
- Extend domain records and repositories for owner-created Gateway Agents,
  one-time token issue/rotate/revoke, authentication, job enqueue/claim/settle,
  lease expiry, and truthful connection status.
- Keep principal, workspace membership, binding, and history records stable when
  credentials rotate or revoke.

### Files

- `infra/postgres/migrations/004_agent_gateway.sql`
- `src/domain/collaboration.ts`
- `src/server/postgres/agent-gateway-repository.ts` (new)
- `src/server/postgres/principal-repository.ts`
- `tests/integration/collaboration-migration.test.ts`
- `tests/integration/agent-gateway-repository.test.ts` (new)

### Verification

- RED/GREEN PostgreSQL tests for one-time plaintext, hash-only persistence,
  owner authorization, unique handle, rotate/revoke, token isolation, lease
  expiry, cross-Agent denial, and duplicate terminal settlement.
- Migration acceptance against both an empty database and the current V0.7
  checksum baseline.

## Phase 2: Gateway Adapter And Existing Run Reuse

### Deliverables

- Implement one `yoyoo-agent-gateway` adapter that enqueues the existing parsed
  `AgentRunRequest`, waits within a finite window, and yields one validated
  completed or failed `AgentEvent`.
- Register the adapter once in the collaboration runtime; newly created Agent
  bindings reuse it without mutating the registry at runtime.
- Preserve existing room routing, context, run events, retries, output messages,
  and failure sanitization.

### Files

- `src/agents/gateway-adapter.ts` (new)
- `src/server/agent-gateway-service.ts` (new)
- `src/server/runtime.ts`
- `src/server/collaboration-service.ts`
- `tests/agents/gateway-adapter.test.ts` (new)
- `tests/integration/agent-gateway-service.test.ts` (new)

### Verification

- Test-first adapter checks for enqueue, completed/failed mapping, abort,
  timeout, invalid terminal payload, and no post-terminal event.
- Integration round trip from a normal room message through the current
  coordinator to one persisted Agent output message.

## Phase 3: Versioned Browser And Agent HTTP Contracts

### Deliverables

- Add owner-authorized Agent directory create/list/rotate/revoke endpoints.
- Add Bearer-authenticated Agent session, heartbeat, job claim, and result routes.
- Use strict input schemas, stable 400/401/403/404/409/410 errors, bounded
  payloads, encoded identifiers, and idempotent result responses.

### Files

- `src/app/api/v1/workspaces/current/agents/route.ts` (new)
- `src/app/api/v1/agents/[agentId]/credential/route.ts` (new)
- `src/app/api/agent/v1/session/route.ts` (new)
- `src/app/api/agent/v1/jobs/route.ts` (new)
- `src/app/api/agent/v1/jobs/[jobId]/result/route.ts` (new)
- `src/server/http-response.ts`
- `tests/integration/agent-gateway-http.test.ts` (new)

### Verification

- HTTP tests cover every success and public failure status, revoked/rotated
  tokens, cross-Agent job access, duplicate result, oversize payload, and lease
  reclaim without exposing token hashes or another Agent's work.

## Phase 4: AI Directory And Room Handoff

### Deliverables

- Add `/settings/agents` as the low-frequency AI directory and point the existing
  bottom settings/more destination to it.
- Render list, empty, create, one-time-secret, connecting, connected, offline,
  rotating, revoked, success, and recoverable error states.
- Reuse V0.7 room details for actual room membership; do not duplicate room
  assignment inside the directory.
- Keep desktop/mobile layout quiet and consistent with the existing dark spatial
  system, with accessible controls and no homepage change.

### Files

- `src/lib/agent-directory-client.ts` (new)
- `src/app/settings/agents/page.tsx` (new)
- `src/components/agents/agent-directory.tsx` (new)
- `src/components/shell/sidebar.tsx`
- `src/styles/agents.css` (new)
- `src/app/globals.css`
- `tests/ui/agent-directory-client.test.ts` (new)
- `tests/ui/agent-directory.test.tsx` (new)
- `e2e/agent-gateway.spec.ts` (new)

### Verification

- UI tests prove all visible states, one-time secret behavior, confirmation,
  keyboard flow, and that no token is rendered after leaving the success state.
- Desktop/mobile Playwright proves create, truthful status, room add, real
  response persistence, rotation/revocation, touch targets, overflow, and zero
  console errors.

## Phase 5: Reference Bridge, Full Gate, And Handoff

### Deliverables

- Add a separate polling reference client and YOS bridge using only the public
  Agent Gateway contract; the bridge receives its token from an environment
  variable and never writes it to source or logs.
- Add deterministic bridge acceptance by default and an explicit live YOS round
  trip gated by environment flags.
- Update README, Roadmap, and
  `开发过程/017_Feature_Agent_Gateway与真实AI接入.md`.

### Files

- `scripts/agent-gateway-client.mts` (new)
- `scripts/run-yos-gateway-agent.mts` (new)
- `tests/integration/agent-gateway-bridge.test.ts` (new)
- `tests/integration/yos-agent-gateway-live.test.ts` (new, explicitly gated)
- `package.json`
- `README.md`
- `开发过程/000_Roadmap.md`
- `开发过程/017_Feature_Agent_Gateway与真实AI接入.md` (new)

### Verification

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run test:integration`
- `npm run build`
- `npm run test:e2e`
- Explicit live YOS gateway test using the existing private environment file.
- Rebuild and restart the verified local production preview on port 4175.

## Risks

- **Second message core:** the Gateway Adapter must consume the current contract
  and settle the current run; Gateway tables store transport state only.
- **Credential leakage:** plaintext exists only in the create/rotate response;
  tests inspect storage and logs for absence.
- **Fake presence:** online derives only from recent authenticated heartbeat;
  stale heartbeat becomes offline deterministically.
- **Duplicate output:** one job per run plus an idempotent terminal transaction;
  the current coordinator remains the only output-message writer.
- **Stuck lease:** finite lease, authenticated reclaim, and bounded adapter wait.
- **SSRF/provider coupling:** no arbitrary callback URL or provider secret enters
  the product; YOS lives in a separate bridge process.
- **Runtime restart:** durable transport state survives; an interrupted current
  room run follows the existing explicit retry contract rather than claiming
  invisible exactly-once execution.

## Out Of Scope

WebSockets, token streaming, cancellation propagation, delegation, Artifact
ingress, concurrent leases, provider forms, arbitrary endpoints, marketplace,
model/Prompt/persona/Skill editing, hosted Agents, multi-human access, files,
tasks, voice, unread notifications, billing, and homepage changes.

# Delivered V0.7 Development Plan Reference

> Status: delivered; final verification recorded in `开发过程/016_Feature_房间详情与成员管理.md`

## Delivery Objective

Replace the room-row popover with a responsive right details pane and expose the
existing room-membership model through an owner-authorized, provider-neutral
add/remove contract. Reuse `room_members`; add no migration or dependency.

## Phase 1: Membership Boundary

- Add repository/service operations for eligible workspace members and member removal.
- Require an active owner for mutations.
- Preserve history, reject owner removal, and reject removal during active Agent runs.
- Make add/restore and repeated remove deterministic.

Files: `src/domain/collaboration.ts`, `src/server/postgres/room-repository.ts`,
`src/server/collaboration-service.ts`, and PostgreSQL integration tests.

Verification: failing-then-passing tests for eligibility, authorization,
idempotency, history preservation, active-run conflict, re-add, and routing exclusion.

## Phase 2: HTTP And Browser Contract

- Add room-member collection/item Route Handlers using current Next.js 16 async params.
- Return stable 400/403/404/409 public errors.
- Extend the room client with candidate, add, and remove operations.

Files: `src/app/api/v1/rooms/[roomId]/members/route.ts`,
`src/app/api/v1/rooms/[roomId]/members/[principalId]/route.ts`,
`src/server/http-response.ts`, `src/lib/room-client.ts`, and contract tests.

Verification: HTTP tests prove allowed transitions and every public failure status;
client tests prove response parsing and encoded route construction.

## Phase 3: Three-Pane Room Details

- Make the existing room-row overflow action select the room and open details directly.
- Move rename, copy link, and archive into the right pane.
- Add one roster, an inline candidate picker, removal controls, and all visible states.
- Keep people and Agents structurally equal while labeling their principal kind.
- Use a fixed desktop pane, right overlay at compact widths, and full-width mobile surface.

Files: `src/components/conversation/collaboration-room.tsx`,
`src/styles/conversation.css`, UI tests, and Playwright acceptance.

Verification: desktop/mobile open, close, add, remove, re-add, routing update,
owner protection, failure recovery, keyboard access, touch targets, overflow, and console checks.

## Phase 4: Full Verification And Handoff

- Run lint, typecheck, unit/UI, PostgreSQL integration, production build, and E2E.
- Update README, Roadmap, and `开发过程/016_Feature_房间详情与成员管理.md`.
- Rebuild and restart the verified local production preview on port 4175.

## Risks And Controls

- **Stale routing:** refresh the authoritative room snapshot after every mutation.
- **Run/member race:** serialize removal and active-run checks in one transaction lock.
- **History loss:** status-transition membership only; never delete principal or child records.
- **Cross-workspace access:** candidates must join through the room's workspace membership.
- **Layout compression:** preserve a minimum conversation width and switch to overlay/full-width details.
- **Scope expansion:** adding a new workspace principal or external Agent remains a later onboarding flow.

## Out Of Scope

Authentication, invitation, external guests, AI creation/connection, role editor,
listener policy, unread, notification, announcement, search, files, nicknames,
leave/disband, homepage changes, dependencies, and schema migrations.

# Delivered V0.6 Development Plan Reference

> Status: delivered; final verification recorded in `开发过程/015_Feature_房间管理与长对话.md`

## Delivery Objective

Add the smallest reversible room-management and timeline-usability layer on top
of V0.5 without changing the schema, homepage, or Agent protocol.

## Phase 1: Room Summary And Lifecycle Boundary

- Extend the room repository with activity summaries, owner-authorized rename,
  archive, and restore.
- Serialize lifecycle changes with advisory locks and reject archiving the last
  active accessible room.
- Return active and archived summaries separately.

Files: `src/domain/collaboration.ts`,
`src/server/postgres/room-repository.ts`,
`src/server/collaboration-service.ts`, and repository integration tests.

Verification: RED/GREEN PostgreSQL tests for activity order, preview selection,
authorization, last-room protection, archive preservation, and restore.

## Phase 2: HTTP And Browser Contract

- Add strict `PATCH /api/v1/rooms/:roomId` rename/status input.
- Return stable public conflict errors for invalid lifecycle transitions.
- Extend the room client with rename, archive, and restore calls.

Files: room detail route, HTTP error mapping, room client, and contract tests.

Verification: 400 invalid input, 403 non-owner, 404 inaccessible room, 409 final
active room, and successful rename/archive/restore round trips.

## Phase 3: Room Rail And Timeline Behavior

- Add a compact icon menu, recent-message preview, time label, archived section,
  and visible mutation states to the existing secondary rail.
- Add bottom-aware following and a “back to latest” button to the timeline.
- Preserve desktop density, mobile drawer behavior, keyboard access, and overflow safety.

Files: collaboration room component, conversation CSS, UI tests, and Playwright acceptance.

Verification: desktop/mobile rename, archive, restore, activity ordering, long
timeline reading, focus behavior, touch targets, overflow, and console checks.

## Phase 4: Full Verification And Handoff

- Run lint, typecheck, unit/UI, PostgreSQL integration, production build, and E2E.
- Update README, Roadmap, and `开发过程/015_Feature_房间管理与长对话.md`.
- Rebuild and restart the verified YOS-mode preview on port 4175.

## Risks And Controls

- **Accidental data loss:** archive changes status only; no product hard-delete path.
- **Concurrent final-room archive:** transaction advisory lock plus active-room count.
- **Information leakage:** summaries use the same membership boundary as room listing.
- **Viewport theft:** follow only near the bottom; otherwise surface an explicit control.
- **Scope expansion:** unread state remains V0.7 because it needs a member read cursor.

## Out Of Scope

Unread state, schema migration, dependency, hard delete, room search/pin/folder,
custom membership, notifications, multi-human UX, and homepage changes.

# Delivered V0.5 Development Plan Reference

> Status: delivered and verified on 2026-08-07

## Delivery Objective

Expose the existing multi-room domain as a small, durable IM workspace without
changing the homepage, database schema, Agent protocol, or visual language.

## Phase 1: Repository And Service Boundary

- Add idempotent room creation that validates the current workspace owner.
- Add the creator and all active Agent workspace members inside the same transaction.
- List only active rooms accessible to the current principal.

Files: `src/server/postgres/room-repository.ts`,
`src/server/collaboration-service.ts`, and repository/service integration tests.

Verification: RED/GREEN PostgreSQL tests for access filtering, inherited Agent
membership, duplicate idempotency, and room isolation.

## Phase 2: HTTP And Client Contract

- Make `GET /api/v1/workspaces/current` return the accessible room list.
- Add `POST /api/v1/rooms` with strict room-name and idempotency validation.
- Extend the provider-neutral browser room client with `createRoom`.

Files: current-workspace route, new rooms collection route,
`src/lib/room-client.ts`, and HTTP contract tests.

Verification: 400 for invalid input, one result for duplicate idempotency, and
no access to rooms outside the current principal membership.

## Phase 3: Conversation Room Rail

- Add a secondary room rail only inside `/conversation`.
- Support create, switch, URL restoration, mobile drawer, and all five UI states.
- Tear down old SSE subscriptions before switching and never merge snapshots.

Files: `src/components/conversation/collaboration-room.tsx`, conversation CSS,
UI tests, and Playwright room acceptance.

Verification: create two rooms, send isolated messages, switch, refresh, and
reopen the selected room on desktop and mobile without overflow or console errors.

## Phase 4: Full Verification And Handoff

- Run lint, typecheck, unit/UI, PostgreSQL integration, production build, and E2E.
- Confirm V0.4 shared-context tests still pass.
- Update README, Roadmap, and `开发过程/014_Feature_多房间工作区.md`.
- Restart the verified YOS-mode preview on port 4175.

## Risks And Controls

- **Cross-room leakage:** all snapshot, message, run, and history queries remain keyed by room ID; add explicit two-room tests.
- **Stale subscriptions:** unsubscribe every active run stream before replacing the room snapshot.
- **Unauthorized URL room:** select only from the workspace endpoint's accessible list and keep server room checks authoritative.
- **Duplicate room creation:** require an idempotency key and lock creation at the repository boundary.
- **UI complexity:** one plain room rail; no dashboard cards, room metadata panels, search, or settings.

## Out Of Scope

Room management beyond create/switch, custom room Agent membership, multi-human
access, direct messages, unread state, notifications, semantic memory, migration,
dependencies, homepage redesign, and visual restyling.

# Delivered V0.4 Development Plan Reference

> Status: delivered and verified on 2026-08-07

## Delivery Objective

Provide every room Agent with the same bounded snapshot of prior public room
messages. Keep context construction deterministic and provider-neutral, then
prove Codex and YOS can continue each other's prior turns.

## Phase 1: Contract And Context Selection

- Add a strict history entry schema to the room Agent request.
- Add a pure selector enforcing 24 messages, 16,000 aggregate characters, and
  8,000 characters per message.
- Write failing tests for order, truncation, and empty history.

Verification: targeted contract/context unit tests must show RED before source
implementation and GREEN afterward.

## Phase 2: Persistent Room Boundary

- Extend `CollaborationRunRepository.getExecutionContext` to load only
  completed messages in the same room before the trigger message.
- Exclude the trigger itself and reverse the descending database window into
  chronological adapter order.
- Prove room isolation and a stable same-trigger boundary with PostgreSQL tests.

## Phase 3: Adapter Consumption

- Codex receives a clearly delimited public-history section before the current
  message.
- YOS sends the same bounded room history through its Web Console message.
- Legacy single-conversation requests stay unchanged.

## Phase 4: Verification And Handoff

- Run targeted tests, full unit/UI, PostgreSQL integration, production build,
  and desktop/mobile Playwright checks.
- Run an explicitly enabled real Codex/YOS cross-Agent multi-turn test.
- Update README, Roadmap, and `开发过程/013_Feature_多AI共享上下文.md`.

## Risks And Controls

- **Cross-room leakage:** filter by `room_id` and test with a second room.
- **Nondeterministic parallel context:** filter strictly before the trigger row.
- **Oversized prompt:** enforce count, per-message, and aggregate limits in one
  provider-neutral selector.
- **Platform becoming a Brain:** transport public messages verbatim; do not
  summarize, interpret, rank, or choose what matters.
- **Prompt injection:** label history as untrusted participant messages and keep
  fixed adapter instructions outside the history section.

## Out Of Scope

Semantic memory, cross-room history, context configuration UI, provider session
reuse, migrations, dependencies, visual changes, and new product surfaces.

# Delivered V0.3 Development Plan Reference

## Delivery Objective

Add real Codex as the second external Agent in the existing collaboration room.
Default local mode remains Planner, Builder, and Reviewer. YOS mode becomes
Codex, Local Builder, and YOS. No UI redesign, dependency, or migration is
required.

## Tech Stack And Reuse

- Reuse the existing TypeScript `AgentAdapter`, Agent registry, room runtime,
  PostgreSQL persistence, SSE, retry behavior, and capability-gated UI.
- Invoke the installed Codex CLI with Node.js `child_process.spawn` and argument
  arrays. No shell and no new npm package.
- Use the official non-interactive `codex exec --json --ephemeral` surface with
  `read-only` sandbox and disabled Shell, Apps, and multi-Agent features.

## Phase 1: Adapter Contract

### Deliverables

- `tests/agents/codex-cli-adapter.test.ts`: failing contract, output parsing,
  timeout, process failure, malformed output, and prompt-isolation tests.
- `src/agents/codex-cli-adapter.ts`: minimal process runner and `AgentAdapter`.

### Verification

```bash
pnpm exec vitest run tests/agents/codex-cli-adapter.test.ts
```

The test must fail because the adapter does not exist before implementation,
then pass without invoking a live Codex account.

## Phase 2: Stable Room Registration

### Deliverables

- `tests/agents/runtime-agent-selection.test.ts`: local/YOS composition tests.
- `src/server/runtime.ts`: register Codex only in YOS mode and reuse the stable
  Planner seat identity.
- Existing UI consumes descriptor capabilities without provider-specific code.

### Verification

```bash
pnpm exec vitest run tests/agents/runtime-agent-selection.test.ts \
  tests/ui/collaboration-room.test.tsx
```

The YOS composition must contain exactly Codex, Builder, and YOS. Local mode
must remain unchanged.

## Phase 3: Real Collaboration Evidence

### Deliverables

- `tests/integration/codex-yos-room-live.test.ts`: explicitly gated room test
  proving Codex-only, YOS-only, parallel runs, and persisted replies.
- `.env.example`, `README.md`, `开发过程/000_Roadmap.md`, and a new Feature
  record with supported and unsupported capabilities.

### Verification

Run live tests only with explicit `CODEX_LIVE_TEST=1`; they consume the logged-in
local Codex and send a private message to local YOS. Then run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

## Risks And Controls

- **Prompt-driven local access:** disable Shell, Apps, multi-Agent tools, writes,
  and web search; use a neutral temporary working directory.
- **CLI/version drift:** validate JSONL defensively and report unsupported output
  as a retryable failure.
- **Hung process:** enforce a finite timeout and terminate the subprocess.
- **Large/noisy output:** cap stdout/stderr and never expose raw stderr to room
  users.
- **Credential leakage:** use existing Codex login storage and never copy tokens
  into Yoyoo environment or logs.
- **Identity duplication:** bind Codex to the existing stable Planner external
  key in YOS mode.
- **False capability claims:** advertise no streaming, cancellation,
  delegation, or Artifact support until independently implemented and tested.

## Out Of Scope

- Homepage or room visual changes, database migration, new dependencies,
  multi-room, multi-human, voice, third real Agent, and persistent Codex
  sessions.

# Delivered V0.2 Plan Reference

## Delivery Objective

Deliver one verified room in which Su Bai and three independently addressable
AI Agents can communicate, run concurrently, delegate work, accept human
intervention, and persist a final Artifact. The foundation supports multiple
humans and multiple Agents; V0.2 exposes one human and multiple Agents first.

The accepted homepage is frozen. New collaboration behavior belongs to
`/conversation` and new room APIs. Existing V0.1 conversation endpoints remain
as a compatibility boundary until the homepage and persisted data are safely
migrated.

## Existing Stack To Reuse

- Next.js `16.3.0`, React `19.2.8`, TypeScript `6.0.3`.
- PostgreSQL 17 through `pg` `8.22.0` and forward-only SQL migrations.
- Zod `4.4.3` for all HTTP and Agent boundary validation.
- Existing `AgentAdapter`, registry, run coordinator, SSE event stream, and YOS
  adapter, extended rather than replaced.
- Plain CSS tokens and the accepted owned cinematic visual system.
- Vitest for unit/service tests and Playwright for browser acceptance.

No dependency change is planned for V0.2 foundation work. Any later dependency
addition requires a separate version and necessity review before installation.

## Architecture

```text
Browser
  -> Workspace / Room HTTP + SSE API
      -> Room service
          -> Message router
              -> Run coordinator
                  -> Agent registry
                      -> YOS adapter
                      -> Other capability-declared adapters
          -> PostgreSQL repositories
              -> principals / memberships / rooms / messages
              -> runs / events / delegations / artifacts

Homepage
  -> V0.1 compatibility facade -> same PostgreSQL authority
```

Yoyoo owns identity, membership, permissions, routing, delivery, persistence,
observable task state, artifacts, and audit. Adapters own Agent-specific context
translation and intelligence. The platform never stores hidden reasoning.

## Delivery Rules

- Advance one phase at a time; each phase must pass its listed verification
  before the next begins.
- Write failing tests before new behavior or bug fixes.
- Never edit applied migrations `001` or `002`; add forward-only migrations.
- Preserve the existing homepage with browser screenshot and interaction checks.
- Keep compatibility endpoints until their consumers and old data are proven
  migrated.
- Do not call deterministic adapters real AI in delivery claims.

## Phase 0: Specification And Baseline

### Files

- `Product-Spec.md`: V0.2 source of truth and explicit non-goals.
- `Product-Spec-CHANGELOG.md`: records the V0.1 to V0.2 boundary change.
- `DEV-PLAN.md`: exact implementation and verification sequence.

### Work

- Lock the multi-human/multi-Agent domain boundary and the one-human/multi-Agent
  V0.2 UI scope.
- Record the accepted homepage freeze and compatibility strategy.
- Capture a fresh baseline of lint, type check, unit, integration, build, and
  browser results before source changes.

### Verification

- Search the three planning documents for contradictory one-Agent requirements.
- Confirm no source, migration, dependency, or homepage file changed in Phase 0.
- Run the existing verification suite and record any pre-existing failures
  before implementation begins.

## Phase 1: Collaboration Domain And Migration

### Likely Files

- `infra/postgres/migrations/003_multi_principal_workspace.sql`: create the new
  domain tables and forward-migrate V0.1 data without altering `001` or `002`.
- `src/domain/collaboration.ts`: stable Principal, Workspace, Room, membership,
  delegation, and Artifact types.
- `src/server/postgres/principal-repository.ts`: Principal persistence.
- `src/server/postgres/workspace-repository.ts`: workspace and membership
  persistence.
- `src/server/postgres/room-repository.ts`: rooms, members, messages, mentions,
  and thread context.
- `src/server/postgres/delegation-repository.ts`: delegation lifecycle.
- `src/server/postgres/artifact-repository.ts`: Artifact metadata, content, and
  provenance.
- `tests/integration/collaboration-migration.test.ts`: clean-database and V0.1
  upgrade coverage.
- `tests/integration/collaboration-repositories.test.ts`: persistence,
  constraints, idempotency, and reload coverage.

### Work

- Add `Principal`, workspace membership, room membership, listener policy,
  explicit message sender identity, mentions, thread linkage, delegations, and
  artifacts.
- Backfill the existing owner, configured Agent, and primary conversation into
  a default workspace and room.
- Retain V0.1 records or compatibility views until all consumers are migrated.

### Verification

- Apply migrations on both an empty PostgreSQL database and a database at the
  current `002` checksum baseline.
- Verify uniqueness, foreign keys, room isolation, and retry idempotency.
- Restart the service and prove messages, memberships, delegations, and
  artifacts reload from PostgreSQL.

## Phase 2: Agent Contract, Routing, And Orchestration

### Likely Files

- `src/agents/contract.ts`: add room context, sender identity, mentions,
  reply/thread context, capability declaration, delegation, and Artifact events.
- `src/agents/registry.ts`: register and resolve multiple Agent bindings.
- `src/server/runtime.ts`: load several configured Agent principals/adapters.
- `src/server/message-router.ts`: enforce membership, mentions, reply routing,
  listener policies, and bounded fan-out.
- `src/server/run-coordinator.ts`: allow independent concurrent runs, linked
  child runs, targeted stop, and isolated failure.
- `src/server/delegation-service.ts`: validate and execute Agent-to-Agent
  delegation requests.
- `src/server/artifact-service.ts`: validate and persist produced Artifacts.
- `tests/unit/message-router.test.ts`: routing and noise-prevention cases.
- `tests/unit/agent-contract.test.ts`: capability and event validation.
- `tests/integration/multi-agent-runs.test.ts`: concurrency, delegation,
  intervention, failure isolation, and retry.

### Work

- Route one persisted trigger to one or several authorized Agent bindings.
- Default all Agents to mention-only and bound fan-out and delegation depth.
- Persist ordered run events before broadcasting them.
- Convert typed delegation and Artifact adapter events into authoritative
  platform objects.
- Preserve truthful capability gating for adapters such as current YOS, which
  may not support streaming or cancellation.

### Verification

- Prove an unmentioned Agent does not run.
- Prove two runs overlap and complete independently.
- Prove a delegation creates one linked child run and cannot form an unbounded
  loop.
- Prove a targeted intervention or stop affects only its selected run.
- Prove one failed Agent leaves other runs and the room usable.

## Phase 3: Room API And Client State

### Likely Files

- `src/app/api/v1/workspaces/current/route.ts`: current workspace bootstrap.
- `src/app/api/v1/rooms/route.ts`: room listing and creation boundary.
- `src/app/api/v1/rooms/[roomId]/route.ts`: room snapshot.
- `src/app/api/v1/rooms/[roomId]/messages/route.ts`: persisted message and
  intervention submission.
- `src/app/api/v1/rooms/[roomId]/events/route.ts`: cursor-based SSE stream.
- `src/app/api/v1/rooms/[roomId]/runs/[runId]/route.ts`: targeted stop/retry.
- `src/lib/room-client.ts`: validated browser client and reconnect state.
- `tests/integration/room-api.test.ts`: authorization, validation, routing,
  idempotency, and recovery.

### Work

- Return one coherent room snapshot containing members, messages, active/recent
  runs, delegations, and artifacts.
- Expose message, intervention, stop, retry, and event-cursor operations.
- Keep `/api/v1/conversations/current` working through a compatibility service
  while the homepage remains frozen.

### Verification

- Reject unknown rooms, nonmembers, invalid mentions, malformed events, and
  oversized input with structured visible errors.
- Reconnect from a cursor without duplicate events; reconcile from a snapshot
  when the cursor is stale.
- Repeat all mutating requests with the same idempotency key and prove no
  duplicate objects are created.

## Phase 4: AI-Native Conversation Room UI

### Likely Files

- `src/app/conversation/page.tsx`: load and render the room experience.
- `src/components/conversation/conversation-shell.tsx`: full-height room shell.
- `src/components/conversation/room-header.tsx`: room identity and Agent
  presence/execution strip.
- `src/components/conversation/message-timeline.tsx`: messages, replies,
  threads, and inline system facts.
- `src/components/conversation/run-block.tsx`: compact run status and actions.
- `src/components/conversation/delegation-block.tsx`: parent/child delegation.
- `src/components/conversation/artifact-block.tsx`: final deliverable entry.
- `src/components/conversation/room-composer.tsx`: text, mentions, intervention,
  send, stop, and retry controls.
- `src/styles/conversation.css`: desktop/mobile room layout and states.
- `e2e/multi-agent-room.spec.ts`: browser collaboration scenario.

### Work

- Keep the timeline and bottom composer familiar while making Agent routing,
  parallel execution, delegation, intervention, and artifacts legible.
- Use inline work blocks and progressive disclosure, not dashboard cards or a
  permanent control panel.
- Implement loading, empty, reconnecting, active, partial-failure, stopped,
  error, and success states.
- Leave homepage visual components and CSS untouched except for a proven
  internal compatibility fix that causes no visual change.

### Verification

- Verify keyboard-only mention selection, send, reply/thread navigation,
  intervention, stop, retry, and Artifact opening.
- Verify `1440x900` and `390x844`, long messages, long Agent names, overflow,
  reduced motion, focus, and screen-reader labels.
- Compare homepage screenshots and its primary flow against the pre-change
  baseline.
- Assert no application console errors in Playwright.

## Phase 5: Three-Agent Vertical Slice

### Likely Files

- `src/agents/yos-adapter.ts`: retain the verified real YOS boundary.
- `src/agents/deterministic-adapter.ts`: support clearly labeled development
  roles and typed delegation/Artifact events where required for tests.
- `.env.example`: document non-secret multi-adapter configuration.
- `tests/integration/three-agent-collaboration.test.ts`: complete persisted
  acceptance story.
- `e2e/multi-agent-room.spec.ts`: real-browser acceptance story.

### Work

- Register three independently addressable Agent principals with actual run
  behavior, including at least one real YOS-backed Agent.
- Execute one scenario containing multi-Agent routing, overlapping runs, one
  Agent-to-Agent delegation, one human intervention, and one final Artifact.
- Label deterministic or simulated adapters honestly; do not use them as proof
  of production provider readiness.

### Verification

- Capture run IDs, event ordering, delegation linkage, intervention state, and
  Artifact provenance from PostgreSQL-backed behavior.
- Refresh mid-scenario and after completion and verify exact restoration.
- Inject one Agent failure and prove isolated visible retry while other work
  continues.

## Phase 6: Polish, Security, And Handoff

### Likely Files

- `README.md`: setup, configuration, local run, test, and private deployment.
- `开发过程/000_Roadmap.md`: current phase and remaining product boundaries.
- `开发过程/003_Feature_多人多AI协作房间.md`: decisions, rejected alternatives,
  migration notes, and observed verification evidence.

### Work

- Review permission enforcement, secret redaction, input limits, concurrency
  bounds, delegation depth, reconnect behavior, accessibility, and performance.
- Remove obsolete compatibility code only after consumer and migration evidence
  proves it is unused; this removal is not required for V0.2 acceptance.
- Record what is implemented, tested, independently verified, and still
  deferred as separate facts.

### Final Verification Gate

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run test:e2e
```

Final acceptance also requires a real browser walkthrough at both target
viewports, no application console errors, a homepage regression comparison,
and PostgreSQL evidence for the delegation, intervention, and Artifact story.

## Integration Slice: AI Card Phase 6A

### Deliverables

- Add forward-only `005_aicard_identity_mapping.sql`.
- Add a strict AI Card client for S256 authorization, code exchange, and
  UserInfo validation.
- Encrypt the ten-minute authorization transaction in an HttpOnly cookie and
  reject expired, modified, or substituted state.
- Map a verified human Card to the existing local owner Principal.
- Add a low-frequency AI Card authorization entry under `/settings/agents`
  while preserving the current Agent Gateway.

### Verification

- Contract tests in both repositories.
- Unit tests for PKCE, provider response validation, encryption, expiry, and
  UI result states.
- PostgreSQL tests for stable mapping, existing-owner attachment, and Subject
  separation.
- HTTP tests for callback validation and secret cleanup.
- Full Yoyoo and AI Card gates before claiming Phase 6A self-tested.

### Explicit Non-Goals

- No deletion or migration of existing Agent Gateway credentials.
- No AI Agent runtime authentication through AI Card in this slice.
- No storage of plaintext access or refresh tokens.
- No production deployment or complete OAuth/OIDC compatibility claim.

## Integration Slice: AI Card Phase 6B1

Status: implemented and self-tested on 2026-08-09; independent security and
production acceptance remain pending.

### Deliverables

- Add an explicit `principal_type=ai` authorization intent while keeping the
  existing human-owner intent backward compatible.
- Accept only an AI Card that the authenticated human controls; reject arbitrary
  Principal/Card identifiers on the server.
- Map the AI Card pairwise Subject to one local Agent Principal and activate its
  current-workspace membership in the same database transaction.
- Show AI Card-backed Agents in `/settings/agents` with a distinct identity mode
  and `waiting for runtime connection` state.
- Keep legacy Gateway creation, rotation, revocation, jobs, and history intact.

### Verification

- AI Card integration tests cover controlled selection, foreign-card rejection,
  principal-type enforcement, stable pairwise Subject, and the existing human flow.
- Yoyoo integration tests cover intent sealing, callback type mismatch, idempotent
  Agent mapping, workspace membership, and no duplicate Principal.
- UI tests cover loading, empty, error, success, AI Card-backed display, and
  legacy Gateway compatibility.
- Full lint, typecheck, production build, unit/UI, PostgreSQL integration, and
  desktop/mobile browser gates in both repositories.

### Explicit Non-Goals

- No AI Card node-key runtime session or Agent job transport in Phase 6B1.
- No automatic room membership and no replacement/deletion of `yya_` credentials.
- No plaintext invitation, access, refresh, or runtime token persistence.
- No independent security or production-ready claim.

## Integration Slice: AI Card Phase 6B2

Status: implemented and self-tested on 2026-08-09; not independently accepted or deployed.

### Delivery Objective

Allow an AI Card-backed Agent to use the existing heartbeat, claim, and result
Gateway contract through a short-lived AI Card runtime session, while preserving
legacy `yya_` behavior and Yoyoo-owned rooms, jobs, membership, and presence.

### Phase 1: Runtime Validation Boundary

- Request `agent.runtime` only for AI-principal authorization.
- Extend the strict AI Card client with fail-closed runtime introspection.
- Authenticate either an existing `yya_` credential or a validated AI Card
  runtime token; reject issuer, client, audience, scope, and principal mismatch.

### Phase 2: Principal, Binding, And Presence

- Ensure mapped AI Card Agents receive the existing shared Gateway binding.
- Add forward-only runtime presence storage without persisting bearer tokens.
- Resolve the pairwise Subject to one active local Agent and active workspace
  membership before heartbeat, claim, or result.
- Generalize job leasing to authenticated Gateway Agents instead of requiring a
  legacy credential row.

### Phase 3: Protocol Acceptance

- Reuse the current HTTP routes and Agent Gateway job/lease/result records.
- Add a reference node client that renews the short session through its AI Card
  key and completes one queued job.
- Keep directory presence truthful for AI Card and legacy Agents.

### Verification

- RED/GREEN unit tests for AI-only scope requests and provider response parsing.
- PostgreSQL integration tests for stable Subject resolution, active binding,
  presence, claim/result, cross-Agent isolation, and legacy compatibility.
- Cross-service acceptance for valid session, expiry, node revocation, grant
  revocation, one job claim, and one durable result.
- Full lint, typecheck, unit/UI, integration, build, and E2E gates in both
  repositories before handoff.

### Explicit Non-Goals

- No homepage/chat redesign, automatic room membership, old credential
  migration, streaming, concurrent leases, production deployment, or new
  third-party dependency.

## Main Risks And Controls

- **V0.1 migration breakage:** forward-only migration plus empty/upgrade tests
  and a temporary compatibility facade.
- **Agent reply storms:** mention-only default, bounded fan-out, delegation depth
  limit, and loop detection.
- **Cross-principal data leakage:** server-side workspace/room membership checks
  on every read, mutation, route, and streamed event.
- **Duplicate work:** idempotency keys and uniqueness constraints at message,
  run, delegation, and Artifact boundaries.
- **Adapter mismatch:** capability declarations and per-run visible degradation.
- **UI complexity:** timeline-first composition and progressive disclosure.
- **Homepage regression:** freeze its source surface and require browser snapshot
  and interaction comparison.

## Rejected Alternatives

- **Extend the current `ownerId + agentId` conversation row:** rejected because
  it cannot cleanly represent room membership, multiple senders, or delegation.
- **Build a conventional IM first and add future behavior later:** rejected
  because orchestration objects would again be reduced to message decoration.
- **Redesign the whole product now:** rejected because it increases visual and
  migration risk before the collaboration loop is proven.
- **Make YOS the central Brain:** rejected because Yoyoo is a general platform
  and each Agent must retain its own intelligence and integration boundary.
