# Yoyoo Space V0.9 / IM-1 Product Spec

> Version: v0.9 Daily IM Foundation
>
> Date: 2026-08-10
>
> Status: approved for implementation

## Goal

Turn the existing durable room and multi-Agent runtime into an IM that Su Bai
can use every day. V0.9 must make messages, private files, room history, and AI
file access one coherent permissioned system instead of adding an isolated
upload button.

## Target Users

- V0.9 visible product: Su Bai working with several independently addressable
  AI members in one private workspace and multiple rooms.
- Foundation: the identity, membership, permission, read-state, and resource
  model must continue to support multiple humans later without another storage
  rewrite.

## Problem

V0.8 proves identity, room membership, durable text messages, Agent routing,
execution, and reply persistence. It does not yet provide the daily-use resource
layer expected from an IM: users cannot send images or files, recover historical
files, search a room, maintain read state or drafts, or let an explicitly
addressed Agent read an attachment under room authorization.

Adding only a file-picker icon would create disconnected data and unsafe access.
Files must share the same room, Principal, audit, and revocation boundaries as
messages and Agent runs.

## MVP Scope

### Message Completion

- Keep plain text and explicit `@Agent` routing as the primary composition flow.
- Support reply/quote, copy, sender-authorized edit, and sender-authorized retract.
- Preserve append-only message revision and retraction facts for audit. Normal
  room and Agent context reads expose only the current visible representation.
- Keep idempotent send and retry behavior. A failed retry must not duplicate a
  message, attachment link, or Agent run.

### Private Attachments

- Send up to 10 attachments with optional message text.
- Accept images, PDF, Word, Excel, Markdown, plain text, and ZIP as the initial
  interoperable formats. Other non-executable files may be downloaded but do
  not receive an inline preview.
- Default to 25 MiB per file and 100 MiB per message, with server-owned
  configuration that can only reduce or explicitly raise those limits.
- Show selected, uploading, processing, ready, failed, retrying, and removed
  states without shifting the composer layout.
- Preview supported images, PDF, and safe text in product-controlled viewers;
  download other accepted files with the original display name.
- Store binary data outside the web-public directory under opaque object keys.
  A filename, path, MIME header, or public URL is never an authorization fact.
- Persist SHA-256, detected media type, declared media type, size, uploader,
  workspace, status, and timestamps. Reject executable content, size-limit
  violations, mismatched unsupported types, and incomplete uploads visibly.
- Expire unattached uploads after a bounded cleanup interval. Message-linked
  files remain durable until a future explicit retention policy is approved.

### AI Attachment Access

- A message may combine text, attachments, and explicit Agent mentions.
- Only an Agent selected by normal room routing receives attachment metadata and
  a short-lived, single-resource authorization path for files attached to that
  trigger or its allowed room context.
- The Agent adapter owns file interpretation. Yoyoo transports bytes, metadata,
  provenance, and authorization but does not summarize, reason about, or decide
  whether a file answers the user's request.
- Node, Grant, Principal, workspace membership, room membership, or file-access
  revocation blocks the next resource request. No permanent bearer download URL
  is persisted in a message or run payload.
- Agent-produced downloadable files use the same attachment/resource model and
  record producing Principal, source run, room, and provenance. Existing
  text/Markdown Artifacts remain compatible.

### History And Search

- Search current-workspace visible message text and attachment filenames.
- Filter results by room, sender, resource type, and bounded date range.
- Open a result at its authoritative source message without changing room
  isolation or exposing an inaccessible result count.
- Add a `Files` section to the existing room-details pane, grouped by images,
  documents, archives, and Agent-produced resources.
- V0.9 does not parse or index arbitrary document body text. Semantic, OCR, and
  cross-workspace search remain later work.

### Read State And Drafts

- Persist one last-read message cursor per active room member.
- Show deterministic unread counts on the room rail and clear them only after
  the member has actually viewed the authoritative latest message.
- Restore the member's prior reading position when practical, with an explicit
  jump-to-latest control when newer messages exist.
- Persist one private draft per member and room. Sending clears only the draft
  whose submitted revision matches the saved revision.
- Continue to show truthful connected, offline, working, failed, and revoked
  Agent states. Human typing indicators and presence are not required while the
  visible product remains single-human.

### Conversation And Membership

- Keep existing group rooms, room create/switch, archive/restore, room details,
  and owner/member controls.
- Add a direct-room kind that contains exactly the current human and one Agent.
  Reopening the same active pair reuses the stable direct room.
- Adding or removing a member never rewrites historical sender, message,
  attachment, run, Artifact, or audit attribution.
- Archived rooms remain readable and searchable but reject new messages,
  uploads, drafts submitted as sends, and Agent runs.

## User Stories

- As Su Bai, I can send an image, PDF, or office document with a message and see
  it again after refresh.
- As Su Bai, I can mention one or several AI members and let only those selected
  members read the attached file within the room's permission boundary.
- As Su Bai, I can find an old file by filename or message text and jump back to
  the source message.
- As Su Bai, I can reply, correct, or retract my own message without silently
  destroying its audit history.
- As Su Bai, I can switch rooms without losing drafts, read position, or unread
  state.
- As Su Bai, I can open a stable direct room with one AI or continue using group
  rooms with several AI members.
- As an integration author, I can consume a provider-neutral attachment
  descriptor and authorized resource endpoint without importing provider logic
  into Yoyoo's room core.

## Core Flows

### Send A File To A Room

1. The client validates count and size, then uploads each binary resource using
   an idempotency key while showing real progress.
2. The server authenticates the Principal, validates workspace eligibility,
   streams the body into the private blob store, computes SHA-256, validates the
   detected type, and persists a pending attachment record.
3. The client submits text, mentions, and ready attachment IDs to the room
   message endpoint.
4. One transaction verifies room membership and attachment ownership, creates
   the message, links every attachment, and creates selected Agent runs.
5. Refresh reads the authoritative message and attachment metadata. Binary
   preview/download always rechecks room access.

### Let An Agent Read An Attachment

1. Normal routing selects only eligible mentioned Agents.
2. The run request carries attachment descriptors, not embedded bytes or public
   links.
3. The Agent uses its current authenticated runtime identity to request one
   file. Yoyoo revalidates Principal, node/session, workspace, room, run, and
   attachment scope.
4. Yoyoo streams the resource. The adapter interprets it and returns normal
   events, messages, or produced resources.
5. Revocation or removal denies the next read without deleting historical room
   attribution.

### Recover A Historical Resource

1. The user opens room files or global search and submits a bounded query.
2. The server searches only resources visible to the authenticated Principal.
3. The result identifies its room and source message.
4. Opening the result selects that room, loads the relevant history window, and
   focuses the authoritative source message.

## Functional Requirements

- All attachment, search, read-state, draft, edit, retract, and direct-room
  routes require an authenticated Principal and server-side workspace/room
  authorization.
- An attachment cannot be linked across workspaces or by a Principal that does
  not own the pending upload. Linking and message creation are atomic.
- Binary content is never served from `public/` and never trusted from file
  extension or client-supplied MIME alone.
- Download responses use safe content disposition, MIME, cache, range, and
  anti-sniff headers. Inline rendering is limited to explicitly supported safe
  types.
- Message edits and retractions are authorized, revisioned, timestamped, and
  excluded from future Agent context according to their current visible state.
- Search is paginated, bounded, deterministically ordered, and permission-
  filtered before totals or snippets are returned.
- Read cursors move monotonically for normal reads. Duplicate updates and stale
  draft saves are idempotent and cannot erase a newer state.
- A direct room is unique per workspace and ordered Principal pair while active.
- Existing V0.8 Agent Gateway and AI Card runtime paths receive the same general
  attachment contract; no YOS-only file path is allowed.

## Non-Functional Requirements

- Preserve the accepted homepage. All visible V0.9 changes stay inside the
  conversation surface and existing details pane.
- Use forward-only PostgreSQL migrations. Applied migrations `001` through
  `006` remain byte-for-byte unchanged and both empty-database and upgrade-path
  acceptance are required.
- Start with a local private blob-store implementation behind a small server
  interface. The database stores object keys, never machine-absolute paths.
- Add no storage SDK in the local phase. A production object-store adapter and
  any new dependency require a separate declared decision before installation.
- Upload and download must stream with bounded memory. Interrupted work leaves a
  visible retryable failure or a cleanup-eligible pending record, never a false
  ready resource.
- Keep secrets and physical storage paths out of browser payloads, messages,
  logs, Agent prompts, and audit display.
- Support keyboard operation, visible focus, reduced motion, long filenames,
  narrow screens, and screen-reader labels.
- Verify current desktop Chrome/Safari and mobile Safari/Chrome targets at
  `1440x900` and `390x844` without horizontal overflow.
- Provide loading, empty, uploading, processing, ready, partial failure,
  permission denied, offline, retrying, and success states.

## V2 / Later

- Multi-human registration, invitation, human presence, typing indicators,
  external push notification, and delivery/read receipts per human recipient.
- Full document-content extraction, OCR, semantic/vector search, cross-room
  memory, and knowledge-base governance.
- Cloud-drive synchronization, public sharing links, collaborative document
  editing, version comparison, retention policy UI, and legal hold.
- Voice messages, voice/video calling, screen sharing, and Live-mode transport
  integration with room history.
- Reactions, stickers, announcement, pin board, folders, bulk operations, and
  advanced room administration.
- Production malware scanning and production object-storage deployment. V0.9
  still rejects executable content and never executes or publicly serves files.

## Explicit Non-Goals

- No homepage redesign, dashboard expansion, social feed, calendar, approval,
  payment, marketplace, Skill editor, or visual workflow canvas.
- No semantic claim that Yoyoo understands attachment content.
- No permanent public file URL, cross-workspace resource link, arbitrary local
  path access, or browser-submitted storage key.
- No destructive hard delete of messages, files, rooms, Principals, runs, or
  historical attribution.
- No automatic wake-up of every Agent when a file is posted. Existing explicit
  routing and room listener policy remain authoritative.

## Open Questions

No blocking product questions. V0.9 intentionally chooses private local storage,
filename/message-text search, one human plus multiple AI in the visible product,
and staged delivery over a broad Slack/Feishu clone. Production object storage,
multi-human notification semantics, and document-body indexing require separate
approval after the local daily-use loop is accepted.

## Acceptance Criteria

### Attachments And Permission

- Image, PDF, Word, Excel, Markdown, text, and ZIP fixtures can be uploaded,
  linked to one message, refreshed, previewed or downloaded as specified.
- Empty text with at least one ready attachment is valid; empty text with no
  attachment remains invalid.
- Oversize, blocked, mismatched, interrupted, and duplicate uploads show stable
  errors and create no duplicate linked resource.
- A non-member, removed member, different workspace Principal, guessed object
  key, or stale Agent authorization receives no bytes or resource metadata.
- Range download and supported preview work without loading the whole file into
  application memory.

### AI Resource Loop

- A message with a unique file marker and one Agent mention produces exactly one
  run whose authenticated Agent can read that file and return a durable answer
  based on it.
- An unmentioned Agent receives no attachment grant. Removing room membership or
  revoking its AI Card node/Grant blocks the next read.
- One Agent-produced file is persisted with producer, source run, room, and
  checksum and remains available after refresh.

### Search And IM State

- Message text and attachment filename searches return only authorized,
  paginated results and open the source message in the correct room.
- Room file filters correctly separate image, document, archive, and Agent-
  produced resources.
- Unread counts, monotonic read cursor, reading position, and room draft survive
  refresh and room switching. A stale draft save cannot overwrite a newer draft.
- Reply, edit, and retract remain correct after refresh; search and future Agent
  context reflect the current visible revision while audit retains history.
- Reopening the same active human/Agent direct pair returns the same room.

### Full Gate

- Existing homepage, rooms, members, text messaging, multi-Agent routing,
  Gateway, AI Card mapping/runtime, retry, Artifact, and history tests remain
  green.
- Lint, typecheck, unit/UI, PostgreSQL integration, production build, and real
  browser tests pass with no application console error.
- Desktop and mobile browser acceptance covers loading, empty, success, upload
  progress, partial failure, retry, permission denied, archived room, long
  filename, and narrow viewport behavior.

# Delivered V0.8 Product Spec Reference

> Version: v0.8 Agent Gateway
>
> Date: 2026-08-08
>
> Status: approved for implementation

## Goal

Let an external AI become a first-class Yoyoo principal: create its identity,
connect it through one provider-neutral protocol, add it to an existing room,
deliver a real room request, and persist its reply in the shared timeline.

## Target User

Su Bai working alone with multiple AI Agents in one private workspace. The
identity and protocol foundation must remain suitable for future multi-human
workspaces, but public account and invitation flows remain outside this release.

## Problem

V0.7 can add existing workspace Agents to rooms, but all Agent identities and
adapters are still created by server bootstrap code. A user cannot introduce a
new AI through the product, prove that it is genuinely connected, or revoke its
access. The current room therefore demonstrates collaboration but does not yet
close the general Agent onboarding loop.

## MVP Scope

- Add a low-frequency AI directory under the global settings/more destination.
- Let the workspace owner create an Agent identity with a validated display name
  and handle.
- Generate one high-entropy connection token, show it exactly once, and persist
  only its cryptographic hash and non-secret hint.
- Expose a versioned, provider-neutral Agent Gateway over authenticated HTTPS.
- Let an Agent heartbeat, inspect its own identity, claim one durable pending
  job, and submit one terminal completed or failed result idempotently.
- Derive connected, offline, and revoked states from authoritative credential
  and heartbeat records; never render fabricated online state.
- Register one shared Gateway Adapter inside the existing Agent registry and
  reuse the current room-run coordinator, context contract, persistence, retry,
  and output-message path.
- Make a newly connected Agent an active workspace candidate so V0.7 can add it
  to a room without a second membership UI.
- Support token rotation and revocation with immediate authorization failure for
  the old token.
- Provide a separate reference bridge and explicitly gated live acceptance that
  connects real YOS through the same public Gateway contract.

## V2 / Later

- Streaming event ingress, cancellation propagation, delegation, and Artifact
  upload through negotiated capabilities.
- Multiple concurrent job leases per Agent, richer presence, delivery receipts,
  and per-Agent audit history UI.
- OAuth/provider setup, hosted Agent deployment, marketplace discovery, Agent
  templates, billing, and organization-wide policy.

## AI Card Phase 6A Identity Bridge

This approved integration slice adds AI Card as an external identity authority
without moving Yoyoo-owned rooms, messages, files, tasks, membership, or local
permissions into AI Card.

- The current private workspace owner can authorize the pre-registered
  `yoyoo_dev` client with S256 PKCE and a pairwise Subject.
- Yoyoo maps `(issuer, client_id, subject)` to the existing local owner
  Principal. Display name and handle remain mutable presentation fields and are
  never identity keys.
- Authorization transaction material is short-lived, encrypted, HttpOnly, and
  removed after callback. Plain access and refresh tokens are not persisted.
- Reauthorization reuses the same local Principal so existing rooms, messages,
  files, and attribution remain stable.
- The existing Agent Gateway remains available as a compatibility path.

Not included in Phase 6A: AI Card-authenticated Agent runtime sessions, AI Card
claim UI for new external Agents, migration of existing `yya_` credentials, or
public/multi-human account authentication. Those belong to Phase 6B or later.

## AI Card Phase 6B1 Agent Identity Binding

Phase 6B1 makes an AI Card controlled by the current human owner visible as a
first-class Yoyoo Agent without yet changing the Agent job transport.

- Yoyoo explicitly requests an AI principal during authorization. AI Card must
  show only active AI Cards controlled by the authenticated human and must
  validate that control relationship again on the server when consent is
  submitted.
- The returned pairwise Subject maps to one stable local Agent Principal.
  Reauthorization updates presentation fields but never creates a second Agent.
- A newly mapped Agent becomes an active member of the current workspace and is
  visible in the AI directory as `waiting for runtime connection`. It is not
  automatically added to every room.
- Existing human-owner authorization remains unchanged and type confusion is
  rejected at callback.
- The current `yya_` Agent Gateway remains a compatibility path. AI Card-backed
  Agents do not receive a replacement bare long-lived Yoyoo token in this slice.

Not included in Phase 6B1: node-key runtime sessions, job claim/result transport,
automatic room membership, old credential migration, public accounts, or
production deployment. Those belong to Phase 6B2 or later.

## AI Card Phase 6B2 Agent Runtime Transport

Phase 6B2 connects an already mapped AI Card Agent to the existing provider-
neutral Agent Gateway without turning Yoyoo into a second identity authority.

- An AI Card node exchanges its Ed25519 proof for a two-minute runtime token
  bound to `yoyoo_dev`, the `yoyoo` audience, `agent.runtime`, its pairwise
  Subject, and its node ID.
- Yoyoo validates that token with AI Card on every heartbeat, job claim, and
  result request. Yoyoo does not persist the plaintext token, node public key,
  controller relationship, or AI Card grant state.
- The validated pairwise Subject resolves to the existing local Agent Principal.
  The Agent must still be active, be an active workspace member, and have the
  shared Gateway binding enabled.
- Runtime presence is Yoyoo-owned transport state. It records only the local
  Principal, workspace, issuer/client/node references, and last-seen timestamps.
- Node or grant revocation fails the next request immediately. A revoked node
  cannot settle an existing lease; normal lease expiry makes the job reclaimable.
- Existing `yya_` Gateway credentials remain compatible and visibly labeled as
  the legacy connection path.

Not included in Phase 6B2: automatic room membership, old credential migration,
streaming, concurrent leases, arbitrary identity providers, public accounts, or
production deployment.

## User Stories

- As the workspace owner, I can create an AI identity and receive the one secret
  needed to connect it.
- As an external AI, I can authenticate without receiving access to another
  principal or workspace.
- As the workspace owner, I can see whether the AI has actually connected and
  add it to a room using the existing room details pane.
- As a room participant, I can address the connected AI and see its durable reply
  in the same timeline as humans and other Agents.
- As the workspace owner, I can rotate or revoke the credential without deleting
  the Agent's historical messages.

## Core Flows

1. Open settings/more and enter the AI directory.
2. Create an Agent; Yoyoo returns a one-time token and connection instructions.
3. Start an external bridge with the Yoyoo URL and token.
4. The bridge authenticates and heartbeats; the directory changes from never
   connected to connected using server timestamps.
5. Add the Agent from the existing room-details member picker.
6. Address the Agent in a room; the Gateway Adapter durably queues its existing
   `AgentRunRequest` and waits for a terminal result.
7. The bridge claims the job and posts a completed or failed result once; Yoyoo
   settles the existing run and persists the output message.
8. Rotate or revoke the token; the prior token immediately receives 401 and can
   no longer claim or complete work.

## Functional Requirements

- Only the active workspace owner can create, rotate, or revoke Agent access.
- Agent handles are unique inside the workspace and use the existing handle
  character and length rules.
- Token creation and rotation are atomic; plaintext is never readable again.
- A token authenticates exactly one active Agent principal and cannot invoke
  owner/browser administration endpoints.
- Job claim is durable, lease-based, and limited to the authenticated Agent.
- Repeated claim or result submission cannot create duplicate runs, events, or
  output messages.
- An offline or reconnecting bridge can resume an unexpired job without changing
  principal identity; abandoned leases become claimable again.
- Revocation blocks heartbeat, claim, and result submission immediately while
  preserving rooms, memberships, runs, and message attribution.
- V0.8 terminal results are either a bounded complete text reply or a bounded,
  sanitized failure. No hidden reasoning is accepted or stored.

## Non-Functional Requirements

- Use a forward-only PostgreSQL migration; never rewrite an applied checksum.
- Use Node cryptography and the current stack; add no runtime dependency.
- Apply constant-time credential verification where comparison occurs, strict
  Zod request validation, payload limits, lease timeouts, and stable public errors.
- Do not accept arbitrary callback URLs or proxy user-supplied endpoints.
- Keep Agent protocol routes independent from browser cookie assumptions and
  reject missing, malformed, disabled, or revoked Bearer credentials.
- Provide loading, empty, creating, one-time-secret, connected, offline,
  rotating, revoked, success, and recoverable error states.
- Preserve the accepted homepage and current conversation visual language.

## Open Questions

No blocking product questions. V0.8 intentionally chooses pull-based HTTPS with
durable leases over WebSockets so reconnect and idempotency can be proven using
the current Next.js/PostgreSQL stack. Realtime streaming remains a later protocol
capability rather than a hidden V0.8 requirement.

## Acceptance Criteria

- A new Agent can be created from the AI directory and its token is shown once.
- Database inspection proves only the token hash and hint are persisted.
- The reference client authenticates, heartbeats, claims only its own work, and
  changes the UI to a truthful connected state.
- The connected Agent appears in V0.7's candidate list, can join a room, receives
  one real request, and writes one durable response visible after refresh.
- Disconnect/reconnect during a lease does not lose the job or duplicate output.
- Duplicate result submission returns the same settlement and creates no extra
  event or message.
- Rotation invalidates the previous token; revocation blocks all Agent routes.
- Cross-Agent and cross-workspace claim attempts fail without leaking job data.
- One explicitly enabled real YOS bridge completes the same round trip through
  the public protocol; default tests remain deterministic and private.
- Existing homepage, multi-room, membership, routing, persistence, retry, build,
  and desktop/mobile browser gates remain green.

## Explicit Non-Goals

- No WebSocket transport, token streaming, cancellation, delegation, Artifact
  ingress, or more than one concurrent claimed job per Agent.
- No arbitrary endpoint configuration, provider API-key storage, model picker,
  Prompt/persona editor, Skill editor, hosted runtime, or marketplace.
- No public registration, human invitation, organization administration,
  payments, files, tasks, voice, unread notifications, or homepage redesign.
- No conversion of Yoyoo into an AI Brain: reasoning, memory, tools, execution,
  and reply decisions stay inside the connected Agent.

# Delivered V0.7 Product Spec Reference

> Version: v0.7 room details and membership
>
> Date: 2026-08-07
>
> Status: delivered; final verification recorded in `开发过程/016_Feature_房间详情与成员管理.md`

## Goal

Complete the conversation workspace's three-pane structure: navigation on the
left, the shared room in the center, and an on-demand room-details pane on the
right where an owner can see and manage the room's current human and AI members.

## Target User

Su Bai working alone with multiple existing workspace AI Agents. The domain
continues to treat humans and Agents as equal principals, while public
multi-human invitation and authentication remain later work.

## Problem

V0.6 makes rooms durable and manageable, but every new room still inherits all
workspace Agents and the compact overflow popover only exposes rename/archive.
Users cannot see the room roster in one stable place or choose which existing
AI Agents belong to a specific room.

## MVP Scope

- Replace the compact room overflow popover with an on-demand right details pane.
- Selecting a room's overflow action selects that room and opens its details.
- Show active human and AI members with the same member-row structure and clear kind labels.
- Add an active workspace member to an active room without creating duplicates.
- Remove a non-owner room member without deleting messages, runs, or Artifacts.
- Re-adding a removed member restores the same membership record.
- Reject removal of the room owner and any Agent with an active room run.
- Immediately remove an unavailable Agent from composer routing choices.
- Keep rename, copy-link, and archive controls inside the details pane.
- Preserve the accepted homepage, room rail, message timeline, Agent protocol, and room history.

## Core Flows

1. Open a room's overflow action; Yoyoo selects that room and opens the details pane.
2. Review the current roster, with people and Agents in one list.
3. Choose “添加成员” and select from active workspace members not already in the room.
4. Add or restore an Agent; it becomes immediately available in the composer.
5. Remove a non-owner member; prior authored content remains attributable and visible.
6. Close the details pane; the conversation returns to its full available width.

## Acceptance Criteria

- Only an active room owner can add or remove room members.
- The candidate list contains only active principals from the same workspace.
- Duplicate add and repeated remove requests are deterministic and do not create extra records.
- The room owner cannot be removed; an Agent with a queued/running/waiting run cannot be removed.
- Removed Agents cannot be mentioned, delegated to, or selected for a new run.
- Historical messages, runs, delegations, and Artifacts survive removal and re-add.
- Desktop renders a stable right pane; compact desktop overlays from the right; mobile uses a full-width details surface.
- Loading, empty, saving, success, conflict, forbidden, and retry states remain visible.
- Existing multi-room isolation, lifecycle, long-timeline, and multi-Agent checks remain green.

## Explicit Non-Goals

- No invitation, registration, authentication, external guest, or multi-human administration UI.
- No creation, cloning, marketplace discovery, credentials, or adapter setup for a new AI.
- No member roles beyond the existing owner/member contract and no listener-policy editor.
- No unread cursor, notification settings, announcement, search, pin, file browser, or room nickname.
- No hard delete, leave/disband workflow, homepage change, dependency, or schema migration.

# Delivered V0.6 Product Spec Reference

> Version: v0.6 room usability
>
> Date: 2026-08-07
>
> Status: delivered; final verification recorded in `开发过程/015_Feature_房间管理与长对话.md`

## Goal

Turn the proven multi-room slice into a workspace that can be used every day:
rooms are recognizable, ordered by real activity, safely manageable, and long
conversations remain stable while new messages arrive.

## Target User

Su Bai working alone with multiple AI Agents across several durable rooms.

## Problem

V0.5 proves room creation, switching, URL restoration, and isolation, but every
room is rendered as a name-only row in creation order. Mistyped names cannot be
fixed, inactive rooms cannot be removed without deleting data, and new timeline
content can interrupt reading or remain out of view.

## MVP Scope

- Rename an active room to a validated name between 1 and 80 characters.
- Archive an active room without deleting its messages or related records.
- Restore an archived room from a collapsed archived section in the room rail.
- Prevent archiving the final active room in a workspace.
- Show each active room's latest completed public-message preview and time.
- Order active rooms by latest message activity, falling back to room update time.
- Add visible rename, archive, restore, saving, success, and error states.
- Follow new timeline content only while the user is already near the bottom.
- Show a “back to latest” control when new content arrives while the user reads older messages.
- Keep the homepage, Agent protocol, room isolation, and mobile drawer behavior unchanged.

## Core Flows

1. Open `/conversation`; the most recently active accessible room appears first.
2. Open a room menu to rename it or archive it.
3. Archiving switches to the next active room and moves the old room into “Archived”.
4. Restore returns an archived room to the active list without losing history.
5. Sending or receiving a message updates the room preview and activity order.
6. New content follows the viewport only at the bottom; otherwise a return control appears.

## Acceptance Criteria

- Rename persists after refresh and rejects blank, oversized, inaccessible, or archived rooms.
- Archive preserves all room data, rejects the last active room, and disappears from the active list.
- Restore makes the same room and history accessible again.
- Active rooms are sorted by their latest completed message; preview text truncates safely.
- A room menu is keyboard accessible and usable in the mobile drawer.
- Long timelines do not jump while the user reads older messages.
- Existing multi-room isolation and Agent collaboration browser checks remain green.

## Explicit Non-Goals

- No unread badge or member read cursor; that requires a dedicated forward-only migration in V0.7.
- No hard deletion, bulk management, search, pinning, folders, custom room membership, or notifications.
- No multi-human invitation, public authentication, direct message, cross-room memory, or homepage redesign.
- No new runtime dependency or database migration.

# Delivered V0.5 Product Spec Reference

> Version: v0.5 multi-room workspace
>
> Date: 2026-08-07
>
> Status: delivered and verified

## Goal

Turn the current single-room collaboration screen into the smallest useful IM
workspace: one human can create and switch between multiple rooms, each with
its own durable messages, runs, Artifacts, and shared multi-Agent context.

## Target User

Su Bai working with multiple AI Agents inside one private Yoyoo workspace.
Multi-human invitation and organization administration remain later work.

## Problem

The data model already supports multiple rooms, but the current API exposes only
the bootstrap room and the UI always opens the first room. Different projects
therefore share one long timeline and cannot preserve separate collaboration
contexts.

## MVP Scope

- List every active room in the current workspace that the current principal can access.
- Create a named room from the conversation page.
- Add the creator and all active workspace Agent members to the new room.
- Switch rooms without leaving `/conversation`.
- Store the selected room in `?room=<id>` so refresh and copied local URLs reopen it.
- Keep messages, Agent runs, delegations, Artifacts, and V0.4 history isolated by room.
- Add a quiet secondary room rail on the conversation page only; retain the existing global sidebar and homepage.
- Provide loading, empty, error, creating, and ready states on desktop and mobile.

## Core Flow

1. Open `/conversation`; Yoyoo loads the accessible room list.
2. If the URL contains an accessible room ID, open it; otherwise open the first room.
3. Create a room with a validated name between 1 and 80 characters.
4. The server creates membership for the owner and current workspace Agents in one transaction.
5. The new room becomes selected and its ID is written to the URL.
6. Switching rooms closes old run subscriptions and loads the selected room snapshot.

## Acceptance Criteria

- Two rooms can be created, switched, refreshed, and reopened from their URL.
- A message sent in one room never appears in another room or enters its Agent context.
- Every new room contains the current human plus Codex, Local Builder, and YOS in YOS mode.
- Duplicate submissions with the same idempotency key create one room.
- An inaccessible or unknown `room` query falls back to the first accessible room without exposing data.
- Desktop and mobile provide usable room switching without horizontal overflow.
- Existing homepage, V0.4 shared context, retry, cancellation, build, and browser gates remain green.

## Explicit Non-Goals

- No room deletion, archive, rename, search, pinning, unread count, ordering controls, or custom avatar.
- No per-room Agent membership editor; new rooms inherit all active workspace Agents.
- No multi-human invitation, public authentication, organization roles, direct messages, threads, or notifications.
- No semantic memory, cross-room context, dashboard change, dependency, or database migration.

# Delivered V0.4 Product Spec Reference

> Version: v0.4 shared room context
>
> Date: 2026-08-07
>
> Status: delivered and verified

## Goal

Turn the existing multi-Agent room from independent one-shot replies into a
real multi-turn shared conversation. Every selected Agent receives the same
bounded, deterministic snapshot of recent public messages from the current
room before it receives the current trigger.

## Scope

- Add recent room history to the general room `AgentRunRequest` contract.
- Include only completed public messages from the same room that were created
  before the trigger message.
- Preserve chronological order while bounding both message count and total
  context characters.
- Include human and Agent sender identity without interpreting message content.
- Let Codex and YOS serialize the same general context into their own request
  boundary.
- Keep retries deterministic by rebuilding context around the original trigger.
- Prove a later Codex turn can use a prior YOS reply and a later YOS turn can
  use a prior Codex reply.

## Product Boundary

- Yoyoo owns deterministic retrieval, room isolation, ordering, limits, and
  transport of public collaboration facts.
- Connected Agents own interpretation, memory strategy, reasoning, and reply
  generation. Yoyoo does not summarize, rank, embed, or infer meaning.

## Acceptance Criteria

- An Agent request contains recent human and Agent messages in oldest-to-newest
  order, excluding the current trigger because it remains the explicit
  `message` field.
- Messages from another room, messages after the trigger, and non-completed
  messages never enter context.
- Context is limited to 24 messages, 16,000 total characters, and 8,000
  characters per message.
- Parallel Agents triggered by the same message receive the same historical
  boundary and cannot nondeterministically see each other's current replies.
- Codex and YOS adapter tests prove they send prior room messages and the current
  message in distinct sections.
- Real marked multi-turn checks prove both cross-Agent directions and database
  restoration.
- Existing local mode, homepage, room UI, migrations, routing, retry, build,
  and browser checks remain green.

## Explicit Non-Goals

- No semantic memory, vector database, summarization, hidden chain-of-thought,
  cross-room memory, persistent provider session, or context settings UI.
- No new room, multi-human login, voice, file, task, or dashboard feature.
- No dependency, database migration, homepage, or CSS change.

# Delivered V0.3 Real Codex Adapter Reference

> Version: v0.3 real Codex adapter validation
>
> Date: 2026-08-07
>
> Status: approved for implementation

## Goal

Prove that Yoyoo can connect a second real, non-YOS Agent through the existing
general `AgentAdapter` boundary. In YOS mode, the room contains real YOS, real
Codex, and the clearly labeled Local Builder. The accepted homepage and room
visual design remain unchanged.

## Target Users

- V0.3: Su Bai using YOS and Codex together in one private room.
- Later: additional real Agent runtimes and invited human collaborators.

## Problem

V0.2 proves the multi-Agent platform loop, but only YOS is a real external
runtime. Planner, Builder, and Reviewer are deterministic acceptance Agents.
Until a non-YOS runtime joins without changing the room, persistence, or routing
core, Yoyoo's general Agent boundary remains only partially validated.

## MVP Scope

- Keep the default local mode unchanged for repeatable automated acceptance.
- In YOS mode, replace Local Planner with Codex while retaining Local Builder
  and the existing real YOS seat.
- Run Codex through the locally installed, authenticated `codex exec` command.
- Use a fresh ephemeral Codex session for every room run.
- Disable Codex Shell, Apps, multi-Agent tools, and writable filesystem access.
- Route a message to Codex alone, YOS alone, or both explicitly.
- Persist Codex replies and run state through the existing room repositories.
- Expose queued, running, completed, failed, timeout, and retry behavior through
  existing room UI without adding provider-specific controls.
- Keep credentials in the local Codex login store; Yoyoo receives no token or
  API key.

## V2 / Later

- Replace Local Builder with a third real Agent.
- Multiple room creation and room history navigation.
- Multi-human authentication, invitations, and permissions UI.
- Optional long-lived Agent sessions after isolation and context rules exist.

## User Stories

- As Su Bai, I can address Codex by itself and receive a real persisted reply.
- As Su Bai, I can select Codex and YOS together and observe independent runs.
- As Su Bai, I can retry a visible Codex failure without breaking YOS or the
  room.
- As an adapter author, I can add Codex without provider-specific changes to
  room APIs, database schema, message routing, or UI components.

## Core Flows

1. `dev:yos` loads the existing YOS server environment and registers Codex,
   Local Builder, and YOS as the room's three stable Agent seats.
2. Su Bai explicitly selects Codex, YOS, or both and sends a message.
3. The platform persists one trigger and creates one independent run per target.
4. The Codex adapter invokes a constrained ephemeral `codex exec` process and
   converts only its final public Agent message into ordered Agent events.
5. Yoyoo persists the reply using the existing run and room repositories.
6. Process, authentication, timeout, and malformed-output failures become
   sanitized retryable run failures.

## Functional Requirements

- Codex must implement the existing `AgentAdapter` contract without extending
  provider-specific fields into shared domain objects.
- Arguments must be passed as a process argument array, never through a shell.
- User room content must be passed as data and cannot alter the fixed isolation
  flags.
- Stdout and stderr must be size-bounded; malformed JSONL and missing final
  messages must fail visibly.
- The subprocess must have a finite timeout and be terminated on timeout.
- Codex is non-streaming and non-cancellable until both behaviors are proven by
  the adapter; the UI must not claim unsupported controls.
- Stable Principal external keys must prevent a fourth room member when
  switching between local and YOS modes.

## Non-Functional Requirements

- No new npm dependency or database migration.
- No homepage, room CSS, YOS adapter, or shared protocol redesign.
- No credential values in source, logs, HTTP responses, tests, or documentation.
- Preserve mention-only routing and failure isolation.
- Support the current Node.js, Next.js, PostgreSQL, Vitest, and Playwright stack.

## Open Questions

- None block V0.3. The Codex model and account entitlement remain owned by the
  installed CLI and authenticated user rather than hard-coded by Yoyoo.

## Acceptance Criteria

- Local default mode still exposes Planner, Builder, and Reviewer.
- YOS mode exposes exactly Codex, Builder, and YOS with no duplicate Principal.
- One real marked Codex reply completes and remains in a fresh room snapshot.
- One message explicitly routed to Codex and YOS creates two independent runs;
  both real replies persist after refresh.
- Codex process failure and timeout become sanitized, retryable run failures.
- An unselected Agent does not run.
- Homepage and room visual browser regressions pass unchanged.
- Lint, type checking, unit/UI, default PostgreSQL integration, production build,
  and desktop/mobile Playwright gates pass.

## Explicit Non-Goals

- No multi-room UI, multi-human login, voice, Agent marketplace, Skill manager,
  task board, or file manager.
- No Codex workspace editing, Shell commands, MCP, Apps, web search, delegation,
  or persistent Codex session in this increment.
- Do not call Local Builder a real external Agent or claim three production
  Agent runtimes.

# Delivered V0.2 Foundation Reference

## Foundation Goal

Build Yoyoo Space as a shared workspace where people and AI Agents are
first-class participants. The platform foundation supports multiple humans and
multiple Agents from the start. V0.2 exposes the smallest useful slice: Su Bai
and at least three independently addressable Agents collaborating in one room.

The current homepage remains visually and behaviorally stable. V0.2 changes the
dedicated conversation page from a one-person/one-Agent chat into an AI-native
collaboration room with explicit routing, parallel work, delegation, human
intervention, and durable artifacts.

Yoyoo owns collaboration facts and safety boundaries. Each connected Agent owns
its understanding, reasoning, memory, skills, and execution decisions. YOS is
the first real adapter, not a product-core dependency.

## Target Users

- V0.2: Su Bai coordinating several AI Agents in a private workspace.
- Later: invited people collaborating with each other and their Agents.

## Problem

The current `ownerId + agentId` conversation model cannot represent multiple
participants, concurrent Agent runs, Agent-to-Agent delegation, or shared
deliverables. Merely widening the current chat screen would produce another
conventional chatbot rather than a collaborative product.

Yoyoo needs a room model in which messages are only one part of the work. Agent
identity, routing, execution state, delegation, intervention, and artifacts must
be durable shared objects that survive refresh and can later support multiple
humans without another foundational rewrite.

## Product Principles

- Familiar entry, future-native behavior: messaging stays understandable while
  Agent orchestration becomes visible and controllable.
- Quiet by default: an Agent listens only when explicitly mentioned unless the
  room grants a different listener policy.
- Platform facts, Agent intelligence: Yoyoo stores observable collaboration
  state, never private chain-of-thought.
- Progressive disclosure: the room timeline is primary; execution details and
  artifacts appear only when relevant.
- Durable over theatrical: every displayed state must correspond to persisted
  or currently observed system state.

## MVP Scope

- One default private workspace and one initial collaboration room.
- A general `Principal` identity model for human, Agent, and system actors.
- Room membership and per-Agent listener policy, defaulting to mention-only.
- Su Bai and at least three independently addressable Agent principals in one
  room, with visible identity, presence, and execution status.
- Plain messages, `@Agent` mentions, replies, and thread context.
- One message routing to one or several selected Agents.
- Independent concurrent runs for multiple Agents.
- Visible queued, running, waiting, completed, stopped, and failed run states.
- One Agent delegating a bounded task to another Agent through a durable
  delegation record and child run.
- Human intervention that can add direction, stop, or retry a targeted run.
- Text/Markdown artifacts with metadata, provenance, and room linkage.
- Refresh and reconnect recovery for messages, runs, delegations, and artifacts.
- Loading, empty, error, reconnecting, partial-failure, and success states.
- Existing homepage appearance and primary interactions remain unchanged.
- YOS as the first real Agent adapter; additional adapters implement the same
  capability-declared contract.

## V2 And Later

- Multi-human sign-in, invitations, roles, room permissions, and presence.
- Browser microphone capture, speech recognition, Agent audio streaming, and
  spoken responses.
- File upload, rich artifact previews, and interactive documents.
- Public Agent discovery, Agent marketplace, billing, and organization admin.
- Visual workflow builders, scheduled automations, social feeds, and public
  spaces.
- Advanced memory inspection and cross-workspace knowledge governance.

## User Stories

- As Su Bai, I can see which humans and Agents share the room and which Agent is
  currently working.
- As Su Bai, I can mention one Agent without waking every other Agent.
- As Su Bai, I can ask several Agents to work at once and follow each result
  independently.
- As Su Bai, I can see when one Agent delegates a task to another and understand
  the parent/child relationship.
- As Su Bai, I can intervene in an active task, stop it, or retry a failure
  without duplicating messages or runs.
- As Su Bai, I can open a completed artifact and recover the whole room after a
  refresh.
- As an integration author, I can add an Agent adapter without importing its
  provider-specific payloads into room UI or persistence code.

## Core Domain Objects

- `Principal`: stable identity for a human, Agent, or system actor.
- `Workspace`: durable collaboration and permission boundary.
- `WorkspaceMember`: a Principal's membership and role in a workspace.
- `Room`: a scoped stream of conversation and work.
- `RoomMember`: room participation plus listener policy and presence metadata.
- `Message`: immutable sender identity, content, reply/thread context, and
  delivery state.
- `Mention`: explicit routing intent extracted from a message.
- `AgentBinding`: adapter configuration and declared capabilities for an Agent
  principal.
- `Run`: one Agent's execution triggered by a message, intervention, or
  delegation.
- `RunEvent`: ordered observable execution events with reconnect cursors.
- `Delegation`: durable parent/child task relationship between two Agents.
- `Artifact`: persisted deliverable with type, content reference, provenance,
  and owning room.

## Core Flow

1. The client loads the current workspace, selected room, members, messages,
   active runs, delegations, and artifacts.
2. Su Bai submits a message. The server validates and persists it with an
   idempotency key before any Agent is invoked.
3. The router resolves explicit mentions, reply/thread context, room membership,
   permissions, listener policies, and adapter availability.
4. The server creates one independent run per selected Agent. Eligible runs may
   execute concurrently.
5. Each adapter receives a stable room-context request. Provider-specific
   translation remains inside the adapter.
6. Ordered status, message, delegation, and artifact events are persisted and
   streamed to the room.
7. An Agent may request a bounded delegation. The platform validates the target,
   persists the delegation, and creates a linked child run.
8. Su Bai may add an intervention, stop a supported run, or retry a terminal
   failure. The action is persisted and scoped to the selected run.
9. A final Artifact is persisted with its producing Agent, source run, and room.
10. Refresh or reconnect reconciles from the last event cursor and authoritative
    PostgreSQL state.

## Functional Requirements

- Every message and action has an explicit `senderPrincipalId`; sender type alone
  is insufficient.
- A message must contain non-whitespace content, respect the documented length
  limit, and target only principals visible in its room.
- Reusing an idempotency key must not duplicate a message, run, delegation, or
  artifact.
- Multiple Agents may run concurrently in one room; a single Agent binding must
  not accidentally execute the same trigger twice.
- Mention-only is the default Agent listener policy. No unmentioned Agent may
  reply unless an explicit room policy or delegation authorizes it.
- Adapter capabilities are declared and enforced for streaming, cancellation,
  delegation, artifacts, and other optional operations.
- Streaming events have ordered IDs and support cursor-based reconnection.
- Agent failures are isolated to their runs and do not make the room unusable.
- Delegations record delegator, delegate, parent run, child run, objective,
  status, timestamps, and failure information.
- Human interventions are visible in room history and auditable.
- Artifacts record their producer and provenance and remain accessible after
  refresh.
- The server remains authoritative; optimistic UI reconciles with server IDs.
- Permissions, membership, routing, idempotency, persistence, and audit are
  platform responsibilities.
- Agent-specific payloads and credentials stay inside server-side adapters.
- Yoyoo must not request, expose, or persist hidden chain-of-thought.

## Non-Functional Requirements

- Use semantic HTML, keyboard-visible focus, screen-reader labels, sufficient
  contrast, reduced-motion behavior, and non-color state cues.
- Preserve stable layout during streaming and partial failures. Long text and
  long unbroken strings must not overflow.
- Support current desktop Chrome/Safari and mobile Safari/Chrome at minimum.
- Verify the room at `1440x900` and `390x844` with no horizontal overflow.
- Preserve the accepted homepage at both target viewports with screenshot and
  interaction regression coverage.
- Use forward-only migrations. Existing applied migrations `001` and `002`
  must not be rewritten; V0.1 data must be migrated or served through an
  explicit compatibility path.
- Keep secrets server-side and redact credentials and sensitive provider errors.
- Bound concurrency and context size so one message cannot trigger an unbounded
  Agent loop or resource spike.
- No public deployment without owner authentication or an explicit private
  network/authenticated reverse-proxy boundary.

## Open Questions

- Which two runtimes will join YOS as the first three production Agent bindings?
  Development may use deterministic adapters, but production readiness cannot
  be claimed until three independently addressable Agent principals demonstrate
  real run behavior.
- Which adapter event should request delegation? The recommended V0.2 boundary
  is a typed delegation event validated and executed by the platform.
- Which Artifact formats follow Markdown? V0.2 intentionally starts with
  text/Markdown and file metadata rather than arbitrary interactive widgets.

## Acceptance Criteria

### Product Boundary

- The existing homepage has no intended visual or primary-interaction change.
- `/conversation` represents a room, not a single owner/Agent transcript.
- The implementation has no required runtime dependency on YOS beyond its
  adapter registration.

### Multi-Agent Collaboration Loop

- Su Bai and three independently addressable Agent principals appear in one
  room with distinct identity and current status.
- A message explicitly routes to the intended Agent or Agents without waking
  unmentioned mention-only Agents.
- At least two Agent runs are observed active concurrently.
- At least one Agent-to-Agent delegation creates a durable delegation and linked
  child run.
- At least one human intervention changes, stops, or retries an active task and
  remains visible in room history.
- At least one final Artifact is generated, persisted with provenance, displayed
  in the room, and restored after refresh.
- At least one Agent uses the real YOS adapter. All three Agent principals have
  actual independently observed run behavior; test doubles are labeled and do
  not justify a production-ready claim.

### Reliability And Experience

- Refresh restores messages, members, runs, delegation state, and artifacts.
- Reconnect resumes from an ordered cursor or visibly reconciles from persisted
  state without a false completed status.
- Retrying with the same idempotency boundary produces no duplicate objects.
- One Agent failure is visible and retryable while other Agents and the room
  remain usable.
- Empty, loading, reconnecting, partial-failure, active, stopped, and success
  states are usable on desktop and mobile.
- Keyboard-only routing, send, intervention, stop, retry, thread navigation, and
  artifact opening are verified in a real browser.
- Lint, type checking, unit tests, PostgreSQL integration tests, production
  build, and Playwright browser tests all pass without application console
  errors.

## Explicit Non-Goals

- Do not redesign the accepted homepage in V0.2.
- Do not ship multi-human authentication, invitations, or organization admin in
  the first UI release, even though the domain model supports them.
- Do not build a social network, dashboard maze, Agent marketplace, billing
  system, file manager, Skill manager, or visual workflow canvas.
- Do not turn Yoyoo into one central intelligence or move Agent reasoning into
  the platform.
- Do not copy Bloome, Glass UI React, legacy Yoyoo source, branding, or assets.
- Do not claim microphone, speech, universal Agent compatibility, A2A
  compliance, or production multi-human readiness before separate verification.
