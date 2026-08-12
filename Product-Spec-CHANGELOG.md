# Product Spec Changelog

## v0.15 - 2026-08-12

- Approved `https://app.yoyooai.com` as the first public preview address with
  exactly one pre-provisioned human owner and no public registration.
- Added one permanent public AI Card ID across human and Agent Principals,
  allocated from `AI_100001`, while retaining Principal UUIDs as authoritative
  internal identity and authorization keys.
- Selected handle plus password for mobile-friendly human login, versioned
  `scrypt` hashes, opaque database-backed sessions, one-time recovery codes,
  throttling, logout, and server-side authorization on every private boundary.
- Kept Agent Gateway and AI Card runtime authentication independent from human
  browser sessions.
- Required HTTPS, persistent PostgreSQL and BlobStore storage, backup-before-
  deploy, health checks, redacted logs, exact release artifacts, and rollback.
- Rejected public registration, social login, SMS/email delivery, AI Card ID as
  a secret, stateless long-lived sessions, and direct exposure of local services.


## v0.13 - 2026-08-11

- Approved a restrained optical-glass system for shared navigation and the
  conversation frame in both light and dark themes.
- Reserved glass for navigation, composition, drawers, and temporary surfaces;
  kept the timeline and messages substantially opaque for long-form reading.
- Standardized navigation, panel, control, floating, edge, blur, saturation,
  and shadow roles instead of one-off transparency values.
- Rejected all-glass content, scenery images, decorative gradients, HUD grids,
  ambient glow blobs, new visual dependencies, and business-layer changes.

## v0.11 - 2026-08-11

- Approved one image-free spatial interface system for light, dark, and system
  preferences across every current Yoyoo route.
- Moved future character from scenery images to semantic surface hierarchy,
  precise borders, restrained glass, Agent presence, and measured motion.
- Kept theme selection as a low-frequency setting and required flicker-free
  first paint plus local preference persistence.
- Preserved the existing information architecture, collaboration behavior,
  database, Agent protocol, and mobile navigation.
- Rejected image brightening, duplicate theme stylesheets, a human avatar, and a
  generic flat IM clone.

## v0.10 / Addressable Conversations - 2026-08-10

- Made immutable IDs authoritative for every person, Agent, room, message,
  permission check, delivery, mention, and audit operation.
- Kept existing UUIDs and room/message history instead of introducing a second
  identity store or routing by mutable display names.
- Approved an authenticated Agent directory and proactive idempotent send to an
  exact accessible `room_id`; sender identity is always derived from auth.
- Added owner-editable room purpose plus per-member pin and remove-from-list
  state. Removal preserves shared facts and reverses on newer activity.
- Replaced static Agent shortcuts with one unified real-conversation rail and
  replaced header Agent cards with search plus a details overflow action.
- Kept hard deletion, natural-language auto-routing, public short IDs,
  federation, public registration, notifications, voice, and homepage changes
  outside V0.10.

## v0.9 / IM-1 - 2026-08-10

- Approved the daily IM foundation for one human working with multiple AI
  members while preserving a future multi-human identity and permission model.
- Added private image/file upload, durable message linkage, safe preview and
  download, upload progress, retry, cleanup, and room-scoped authorization.
- Added a provider-neutral Agent attachment descriptor and short-lived resource
  access path; interpretation remains inside each connected Agent.
- Added authorized message-text and filename search, room file history, source-
  message navigation, and resource-type filters.
- Added append-only reply/edit/retract semantics, unread cursors, per-room
  drafts, reading-position recovery, and stable human/Agent direct rooms.
- Locked the initial visible formats and bounded defaults to 10 files, 25 MiB
  per file, and 100 MiB per message, with server-owned configuration.
- Required a private local blob-store abstraction, streaming I/O, opaque object
  keys, forward-only migrations `007` through `009`, and no new storage SDK for
  local delivery.
- Kept homepage redesign, multi-human UX, external notifications, document-body
  indexing, semantic search, cloud-drive sync, public links, collaboration
  editing, voice/video, and production object storage out of V0.9.
- Rejected an upload-button-only patch because files, permissions, Agent access,
  history, and revocation must form one coherent platform resource boundary.

## v0.8 - 2026-08-08

- Approved a provider-neutral Agent Gateway so external AI can become a
  first-class workspace principal instead of a server-bootstrap fixture.
- Limited the first protocol to hashed one-time credentials, truthful heartbeat
  status, durable single-job leases, and idempotent terminal text/failure results.
- Reused the existing Agent contract, room membership, run coordinator, context,
  retry, persistence, and output-message path rather than adding a second chat core.
- Selected pull-based HTTPS for the first reliable reconnectable transport and
  retained streaming, cancellation, delegation, and Artifact ingress for V2.
- Required an explicitly gated real YOS bridge while keeping the contract and
  default acceptance provider-neutral and deterministic.
- Kept arbitrary endpoints, provider secrets, marketplace, multi-human access,
  files, tasks, voice, unread, and homepage changes out of scope.

## v0.7 - 2026-08-07

- Approved an on-demand right room-details pane as the third conversation column.
- Moved rename/archive into details and placed add/remove membership at the top.
- Limited first delivery to existing active workspace principals, with humans and AI sharing one membership model.
- Required owner authorization, history preservation, owner protection, active-run conflict handling, and immediate routing updates.
- Kept invitations, AI onboarding, unread, notifications, files, homepage changes, dependencies, and migrations out of scope.

## v0.6 - 2026-08-07

- Approved reversible room rename, archive, and restore without hard deletion.
- Added deterministic latest-message summaries and recent-activity ordering.
- Added bottom-aware timeline following and an explicit return-to-latest action.
- Kept unread state for V0.7 because it requires a member read cursor migration.
- Kept the homepage, Agent protocol, dependencies, and database schema unchanged.

## v0.5 - 2026-08-07 (delivered)

- Delivered the smallest multi-room IM workspace: list, create, switch, refresh,
  and URL restoration for rooms inside the current private workspace.
- New rooms inherit the current human and all active workspace Agents while
  preserving room-isolated messages, runs, Artifacts, and Agent context.
- Kept the accepted homepage and global sidebar unchanged; room navigation is a
  secondary conversation-only surface.
- Explicitly excluded room deletion, rename, search, unread state, custom Agent
  membership, multi-human access, dependencies, and migrations.

## v0.4 - 2026-08-07

- Added deterministic, bounded recent room history to the general Agent run
  boundary.
- Locked context to completed public messages in the same room and strictly
  before the trigger, so parallel runs receive the same snapshot.
- Kept interpretation and memory inside each connected Agent; Yoyoo only
  transports ordered public collaboration facts.
- Explicitly excluded semantic memory, vector search, summarization, migrations,
  and UI changes.

## 2026-08-07 - V0.3 Real Codex Adapter Validation

### Added

- A second real, non-YOS Agent through the existing general adapter boundary.
- A YOS-mode room composition of Codex, Local Builder, and YOS while preserving
  stable three-seat identities.
- Ephemeral, read-only, tool-disabled `codex exec` isolation requirements.
- Process timeout, bounded output, sanitized error, retry, and live room
  acceptance requirements for Codex.

### Kept Out Of V0.3

- Homepage or room visual redesign.
- Multi-room UI, multi-human authentication, voice, marketplace, task board,
  file manager, and a third real Agent.
- Codex filesystem writes, Shell, MCP, Apps, web search, delegation, or retained
  session state.

### Reason

V0.2 proves the platform loop but only YOS is a real external runtime. A
constrained Codex adapter is the smallest evidence that Yoyoo can host different
real Agents without becoming a YOS-specific shell or changing its shared core.

## 2026-08-07 - V0.2 AI-Native Collaboration Room

### Changed

- Reframed Yoyoo from one owner plus one Agent into a universal collaboration
  platform whose foundation supports multiple humans and multiple Agents.
- Locked V0.2 UI scope to one human plus at least three independently
  addressable Agents in one room; multi-human UI remains later work.
- Replaced the conversation-centric domain with Principal, Workspace, Room,
  membership, AgentBinding, Run, Delegation, and Artifact objects.
- Added explicit mention-based routing, parallel Agent runs, Agent-to-Agent
  delegation, human intervention, failure isolation, and durable Artifacts.
- Made mention-only the default listener policy to prevent reply storms.
- Clarified the responsibility boundary: Yoyoo owns collaboration facts and
  permissions; each Agent owns its intelligence and provider-specific behavior.
- Kept YOS as the first real adapter while removing it as a product-core
  dependency.
- Froze the accepted homepage and moved V0.2 product change to `/conversation`.
- Added forward-only migration, V0.1 compatibility, homepage regression, and
  three-Agent end-to-end acceptance requirements.

### Removed From V0.2

- The assumption that one primary conversation and one configured Agent define
  the product core.
- Multiple Agents as a later-only capability.
- Any expectation that a visual redesign, multi-human UI, voice transport,
  marketplace, workflow builder, or administration surface is required for the
  first collaboration-room release.

### Reason

The prior model could demonstrate a reliable Agent conversation but could not
support Yoyoo's intended role as a shared workspace for people and multiple AI
Agents. V0.2 upgrades the foundation now while keeping the first visible slice
small enough to implement and verify end to end.
