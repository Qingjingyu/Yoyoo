# Yoyoo Space Roadmap

> Updated: 2026-08-14

## Current State

- V0.17 embedded AI Card entry is implemented on an isolated branch and has
  targeted tests only. Yoyoo now presents product context plus inline login and
  Card creation in one native dual-theme surface. Passwords are posted directly
  from the browser to the exact allowlisted AI Card origin; Yoyoo retains only
  the encrypted PKCE transaction and accepts only its fixed callback origin and
  path. The external-entry button and temporary local-account UI are removed.
  Full regression, build, two-service browser acceptance, merge and production
  deployment are still pending.

- V0.16 / AI Card Phase 8C is deployed and publicly self-verified.
  Forward migrations `015` through `018` stop Yoyoo-local Card allocation, persist a
  verified authoritative `card_id` beside issuer/client/pairwise Subject, and
  support password-independent federated human sessions without changing any
  resource Principal UUID, and prevent one authorization transaction from
  issuing multiple Yoyoo sessions. Federated browser sessions now retain only an
  AES-256-GCM protected refresh grant, revalidate AI Card every five minutes,
  erase protected material on logout or rejection, and allow no more than a
  15-minute provider-outage grace. Identity-authority requests are bounded to
  eight seconds; local harnesses without browser integration omit the Card link,
  while password-mode deployments still fail closed on missing configuration.
  The login page now has one primary AI Card entry and keeps the V0.15 password
  form collapsed only for reversible cutover. The full local-auth browser
  regression is 38/38 across desktop and mobile, with 188/188 unit/UI and
  130/130 default PostgreSQL integration checks passing. A separate cross-repo
  acceptance starts real AI Card and Yoyoo production builds behind temporary
  HTTPS proxies and proves first registration plus second-browser identity
  reuse against isolated databases. It now also proves a claimed YOS Card is
  authorized as `AI_100002`, maps to one stable Yoyoo Agent Principal without
  a `yya_` credential, obtains a two-minute runtime token, discovers an exact
  authorized room ID and persists a message under that Principal. Production
  now uses `https://id.yoyooai.com`, the `yoyoo_prod` client and the exact HTTPS
  callback. Yoyoo runs image `9f28fad` with migrations `015` through `018`;
  the former password login remains collapsed as a recovery path.
  The new-AI admission boundary is also locked locally: YOS and other external
  AI must own an AI Card before the owner authorizes them into Yoyoo. Settings
  no longer offers local Agent creation, and the former public POST returns
  `AI_CARD_REQUIRED`. Existing `yya_` identities remain manageable only as
  migration compatibility. Cross-repository YOS admission is self-verified;
  independent security review and real YOS runtime production acceptance remain pending.
  The production Compose, environment contract and rollback runbook now include
  the independent `id.yoyooai.com` authority and `yoyoo_prod` client, and the
  authority plus Yoyoo cutover are live. No temporary acceptance identity was
  created, so the first real registration remains reserved for the owner.

- V0.15 single-owner public preview is deployed and publicly verified at
  `https://app.yoyooai.com` on an isolated clean production database. It adds
  permanent AI Card IDs from `AI_100001`,
  password and recovery credentials, revocable PostgreSQL sessions, login
  throttling, private page/API enforcement, responsive login/logout UX, health
  readiness, and Caddy or host-Nginx deployment with private Next.js +
  PostgreSQL networking and persistent data volumes. Public acceptance covered
  invalid password, valid login, protected workspace reads, logout, certificate
  renewal, desktop rendering, and a 390x844 overflow check. The approved
  post-release cleanup removes the three empty deterministic demo Agents and
  makes production restart into an Agent-empty workspace; public YOS/Codex
  runtime acceptance remains pending.

- V0.14 internal daily release is implemented and locally verified. The product
  now has one-command real and deterministic
  production startup on `127.0.0.1:4173`, a redacted readiness doctor, and
  additive PostgreSQL + BlobStore backups with inventory and SHA-256
  verification. Startup preserves persistent data across foreground process
  restarts. Restore, reset, public exposure, and background service installation
  remain deliberately outside this release.

- V0.11 image-free dual-theme interface is implemented and locally verified.
  Light, dark, and system preferences share semantic surface,
  typography, border, focus, status, and shadow tokens. The homepage,
  conversation workspace, Agent settings, responsive navigation, overlays, and
  Live mode no longer depend on the rain-city bitmap. The theme preference is
  applied before hydration, persists locally, and follows live operating-system
  changes when set to system. No API, database, Agent protocol, dependency, or
  information-architecture change is included.

- V0.10 addressable conversations is implemented and locally verified. Existing
  UUIDs remain canonical for workspace, Principal, room, and message operations.
  The active slice adds an authenticated Agent directory, exact `room_id`
  delivery, room purpose, per-member pin/hide state, a unified real-conversation
  rail, and a header overflow entry to the existing details pane. Names remain
  presentation-only; hard deletion and natural-language auto-routing are out of
  scope.

- V0.9 / IM-1 six-stage daily IM loop is implemented and verified. It now
  includes private streamed resources and authorization, upload/preview/download,
  provider-neutral Agent file access, authorized message/file search, reply/edit/
  retract, unread counts, revisioned drafts, reading position, and stable
  human/Agent direct rooms. Migrations `007` through `011` are forward-only;
  migrations `001` through `006` remain unchanged. The accepted homepage was not
  modified. Production object storage, semantic document search, malware
  scanning, public multi-human invitation, and external notifications remain
  explicitly outside V0.9.

- AI Card Phase 6B2 Agent runtime transport is implemented and self-tested.
  A claimed node exchanges its Ed25519 proof for a two-minute AI Card session;
  Yoyoo introspects every heartbeat, claim, and result request, maps the pairwise
  Subject to one active local Agent, and persists only local presence. The
  reference YOS bridge consumes the protected AI Card enrollment file and never
  persists the runtime bearer. Legacy `yya_` credentials remain compatible.
  A cold-start local acceptance with fresh human and Agent Cards has completed
  the real three-process AI Card + Yoyoo + external YOS chain, including room
  admission, a persisted YOS reply, and immediate node-revocation enforcement.
  The acceptance found and fixed runtime-presence omission in room candidates.
  Third-party security review, real-hardware acceptance, production deployment,
  and controller-visible Grant management for controlled Agents remain pending.
- AI Card Phase 6B1 Agent identity binding is implemented and self-tested.
  The owner can select an active AI Card they control, authorize it as an AI
  principal, and map its pairwise Subject to one stable local Agent Principal.
  The Agent becomes an active workspace member and appears in the directory as
  `等待运行节点`. The existing `yya_` Gateway remains a labeled compatibility
  path.
- AI Card Phase 6A identity bridge is implemented and self-tested through a
  local two-service authorization flow with a Chrome virtual WebAuthn
  authenticator. The slice adds S256 authorization, encrypted transient callback state,
  strict provider response validation, and stable mapping from the AI Card
  pairwise Subject to the existing local owner Principal. It is additive: the
  Agent Gateway and all historical attribution remain unchanged. Real hardware
  Passkey, independent security, and production acceptance remain pending.
- V0.8 external Agent Gateway: implemented and verified as the historical
  compatibility transport. Its original release allowed workspace owners to
  create external Agent Principals and one-time credentials. V0.16 closes that
  public creation path while retaining rotation/revocation for existing
  identities. Active legacy external processes use
  a provider-neutral heartbeat / claim / result protocol with durable
  single-job leases and idempotent settlement. Connected Agents become eligible
  room members through the existing details pane. The YOS bridge is the first
  reference implementation; the homepage remains unchanged.
- V0.7 room details and membership: implemented. Room management now opens a
  responsive third pane instead of a popover. Owners can inspect, add, remove,
  rename, copy, and archive from one low-frequency surface. Membership changes
  preserve history and attribution; active Agent runs and room ownership are
  protected. The homepage, Agent protocol, dependencies, and schema remain
  unchanged.
- V0.6 room usability: implemented. Active rooms are ordered by real message
  activity, show a bounded latest-message preview, and support owner-authorized
  rename and reversible archive/restore. Long timelines only follow new content
  while the reader is near the bottom; otherwise the UI offers an explicit
  return-to-latest action. The homepage, Agent protocol, dependencies, and
  database schema remain unchanged.
- V0.5 multi-room workspace: implemented. One human can create and switch
  accessible rooms from `/conversation`; each room inherits the active workspace
  Agents and keeps messages, runs, delegations, Artifacts, and bounded Agent
  context isolated. The selected room is durable in the URL, with a persistent
  desktop rail and mobile drawer. The accepted homepage remains unchanged.
- V0.4 shared room context: implemented. Every selected Agent receives the
  same bounded, chronological set of completed public messages from the current
  room before the trigger. Real Codex and YOS have each recovered a fact
  generated by the other, and the resulting messages survived runtime reopen.
- V0.3 real dual-Agent slice: implemented. In YOS mode the stable room seats
  are now real Codex, local Builder, and real YOS. Codex and YOS were verified
  independently and concurrently, and their completed replies restored from
  PostgreSQL after the server runtime was reopened.
- Codex boundary: local authenticated CLI, ephemeral invocation, read-only
  temporary workspace, disabled Shell/Apps/multi-agent features, stdin prompt,
  structured JSONL reply parsing, finite timeout, output caps, sanitized
  failures, and a strict child-process environment allowlist.

- V0.2 collaboration foundation: implemented. The domain now models human,
  Agent, and system Principals, workspaces, memberships, rooms, messages,
  mentions, Agent bindings, runs, ordered events, delegations, and Artifacts.
- V0.2 exposed slice: one human and three independently addressable Agents in
  one room. The schema and service boundaries support later multi-human use;
  invitations, authentication, and organization administration remain deferred.
- Multi-Agent execution: explicit mention routing, bounded parallel fan-out,
  typed Planner-to-Builder delegation, targeted human intervention, isolated
  failure, idempotent retry, and persisted Agent replies and Artifacts are
  implemented.
- Real YOS room seat: `npm run dev:yos` keeps the local Builder, binds Codex to
  the stable Planner seat, and binds YOS to the stable Reviewer seat. This
  preserves existing room identity while moving two seats to real adapters.
- Homepage boundary: frozen. V0.2 changes are confined to the collaboration
  model, room APIs, `/conversation`, and supporting verification/docs.

- Product direction: confirmed.
- Retired Yoyoo active repository: removed from the original path.
- Retired PostgreSQL container and development volume: removed.
- Retired local uploads, Connector state, and action bridge: moved to the macOS
  Trash after direct deletion was rejected by the host safety policy.
- Legacy tracked source snapshot: isolated outside this repository at commit
  `d0a1e0990ec8ec79515995ba48291f07623cfda6`.
- New repository: initialized with no inherited Git history or application code.
- Product spec and development plan: updated for the homepage-first sequence.
- Runtime foundation: implemented with pinned Next.js, React, TypeScript,
  Vitest, Testing Library, ESLint, and Playwright versions.
- Homepage foundation: simplified to an online status, one greeting, one
  composer, and a separate Live-mode interface; browser-verified on desktop and
  mobile.
- Fluid digital life: used only as Live-mode voice feedback at `168px` on
  desktop and `136px` on mobile; the isolated `/orb-preview` route remains for
  motion tuning.
- Interface quality pass: desktop navigation is grouped beneath the brand,
  spacing follows a 4pt token scale, mobile controls retain full touch targets,
  and the homepage surface no longer relies on decorative grids or a broad
  shadow.
- Centered conversation space: the superseded Three.js chamber is no longer
  loaded by the homepage. A 1672x941 rain-city backdrop now fills the shell at
  original resolution while the greeting, current conversation, composer, and
  Live Orb share one stable center axis on desktop and mobile.
- Persistent text conversation: Yoyoo stores human and Agent
  messages, streams deterministic Agent deltas, restores history after refresh,
  and exposes truthful stop, retry, reconnecting, and failure behavior.
- Generic Agent contract: implemented with strict runtime validation, ordered
  terminal events, abort handling, and capability-gated cancellation.
- PostgreSQL foundation: implemented with two forward-only migrations,
  checksum verification, advisory locking, explicit constraints, and the
  persistent `yoyoo_space_pg_data` development volume. Migration `002` adds
  retry idempotency without rewriting the applied `001` checksum.
- Conversation service and HTTP/SSE routes: implemented with transactional
  message-before-run persistence, ordered run events, cursor replay, active-run
  exclusion, idempotent submission/retry, cancellation, and restart recovery.
- Frontend wiring: implemented against the deterministic test Agent and the YOS
  Web Console adapter. Public owner authentication is not started.

## Delivery Stages

1. **Requirements** - Confirmed for homepage foundation
   - Keep v0.1 focused and retain explicit non-goals.
2. **Plan** - Active
   - Homepage sequence is locked; the current YOS Web Console contract has been
     verified read only and implemented behind the generic Agent boundary.
3. **Frontend foundation** - Completed
   - Reproducible Next.js project, tests, responsive homepage, and UI states.
4. **Backend foundation** - Completed
   - Database, Agent contract, persistent service, and versioned event stream.
5. **Golden conversation slice** - Completed for current conversation
   - Full deterministic test-Agent path on desktop and mobile; history drawer
     remains deferred until the product supports multiple conversations.
6. **Real YOS integration** - Completed for the confirmed Web Console contract
   - Adapter, authentication, ordered polling, ten sequential real turns,
     browser persistence, forced link interruption, process restart, and retry
     recovery are verified. Cross-system exactly-once remains unavailable
     because the upstream contract exposes no correlated run ID.
7. **Polish and handoff** - In progress
   - Browser, security, accessibility, source-boundary, and recovery evidence.
8. **V0.2 multi-Agent collaboration room** - Completed
   - One human + three Agent room, parallel runs, delegation, intervention,
     retry, Artifact persistence, real YOS third seat, and responsive UI.
9. **V0.3 real Codex + YOS collaboration** - Completed
   - Codex CLI process boundary, stable room binding, independent and parallel
     real-Agent execution, durable replies, retryable failures, and handoff.
10. **V0.4 shared multi-Agent context** - Completed
   - Provider-neutral bounded room history, stable same-trigger boundary,
     Codex/YOS cross-turn continuation, durable recovery, and handoff.
11. **V0.5 multi-room workspace** - Completed
   - Accessible-room listing, idempotent creation, inherited Agent membership,
     URL restore, responsive navigation, cross-room isolation, and handoff.
12. **V0.6 room usability** - Completed
   - Activity summaries, rename, reversible archive/restore, last-room and
     active-run protections, bottom-aware timeline following, and handoff.
13. **V0.7 room details and membership** - Completed
   - Responsive details pane, owner-authorized human/AI membership changes,
     history preservation, active-run protection, and no-Agent empty state.
14. **V0.14 internal daily release** - Completed
   - One-command production start, prerequisite diagnosis, verified local
     database + BlobStore backup, restart persistence, and operating handoff.
15. **V0.15 single-owner public preview** - Completed
   - Password login, private routes, persistent production data, HTTPS,
     verified backups, and public desktop/mobile acceptance.
16. **Production demo Agent cleanup** - Completed
   - Disable built-in demo seeding in production, delete only the three known
     empty demo Agent identities and memberships, then prove restart stability.

## Decisions

- AI Card is the identity authority for both humans and AI. An external AI such
  as YOS owns its Card before Yoyoo admission; Yoyoo owns only the local
  Principal projection, workspace and room permission, durable delivery, run
  state and audit. The external process owns reasoning, memory, tools and reply
  generation.
- New AI admission is authorization, not creation: display names and handles
  cannot create or identify an AI. Existing Gateway Agents remain first-class
  Principals during migration, but new identities enter only through AI Card.
- External Agents pull jobs over the public HTTPS boundary. V0.8 does not store
  arbitrary callback URLs or provider secrets and does not grant database
  access to bridge processes.
- Gateway jobs permit one active lease per Agent. Expired writers are rejected,
  abandoned leases can be reclaimed, and exact duplicate results are accepted
  idempotently.
- Only connected Gateway Agents are offered as room candidates. Revocation
  disables both authentication and future routing without deleting history.
- Yoyoo remains the primary brand; the product surface is Yoyoo Space.
- The new product is implemented independently, not migrated from legacy code.
- V0.1 uses a small presence-first homepage as the entrance to one primary
  conversation. It does not expand into a dashboard.
- The digital life is functional voice feedback, not persistent homepage
  decoration. Text conversation stays visually quiet.
- Spatial depth belongs to semantic surface hierarchy, fine borders, local edge
  light, and the Live Orb rather than scenery images, extra dashboard cards, or
  HUD decoration. Stateful motion remains reserved for explicit Live mode.
- Product navigation follows functional proximity: primary destinations live
  beneath the brand while settings remains a separate bottom action.
- Third-party visual code is adapted behind a Yoyoo-owned component contract,
  with its license retained and without importing another design system.
- YOS is the first adapter, not a shared-domain dependency.
- The deterministic test Agent remains the repeatable acceptance baseline. The
  YOS request, authentication, whole-message reply, capability, and safe-error
  contract is now confirmed independently.
- The inspected YOS Web Console is a durable whole-message channel, not a model
  SSE API. Yoyoo must not claim token streaming or cancellation for this adapter.
- The Web Console adapter drains an unmatched prior inbound row before sending
  new work. This serializes delayed replies at the available channel boundary
  without pretending that upstream correlation exists.
- The platform owns durable messages, run state, delivery, and recovery. Agent
  adapters own interpretation and response generation; fixed test output is
  acceptance scaffolding, not product intelligence.
- The data model starts multi-human + multi-Agent. V0.2 exposes single-human +
  multi-Agent first to keep the initial product loop small and verifiable.
- A stable room principal identity may change adapter bindings. YOS mode reuses
  the Reviewer seat instead of creating an accidental fourth room member.
- The same binding rule now places Codex in the Planner seat. The product owns
  room identity and durable state; Codex and YOS remain replaceable adapters.
- Codex does not receive arbitrary server environment variables. It uses the
  user's existing local ChatGPT login rather than an API key copied into Yoyoo.
- Mention-only is the default Agent listener policy. “全员参与” is an explicit
  user routing action, not ambient broadcast behavior.
- Shared history is deterministic transport, not platform intelligence. Yoyoo
  filters by room, completion state, and trigger boundary; each Agent decides
  how to interpret the same public facts.
- A room is both the visible IM context and the authorization boundary. V0.5
  inherits all active workspace Agents at creation time to keep setup minimal;
  custom room membership remains a later product decision.
- Room archive is a reversible lifecycle transition, not deletion. V0.6 keeps
  every child record, serializes final-room checks, and leaves reliable unread
  state to V0.7 because it needs a per-member read cursor.
- Room membership is also a reversible lifecycle state. V0.7 keeps historical
  identity and attribution, excludes removed Agents from new routing, and
  reactivates the same membership record when they are added again.
- A child run terminal event and its delegation terminal state commit in one
  transaction. A late cancellation is rejected before an intervention message
  is written, so the room cannot claim that an already-completed run is stopping.
- Third-party AGPL source remains reference-only.

## Rejected Alternatives

- Restyle the retired application: rejected because its product and domain scope
  would continue shaping the new interface.
- Delete all historical source evidence: rejected because a small isolated,
  credential-free snapshot is useful for protocol archaeology and rollback.
- Rebrand Glass UI React: rejected because of license obligations and its generic
  dashboard architecture.
- Add a human-like avatar, real voice transport, tasks, or files to V0.2:
  rejected because they do not improve the first shared-room collaboration
  loop. Multiple Agents are now accepted scope; public multi-human UX remains a
  later release.

## Verified Evidence

- V0.14 internal daily release evidence is recorded in
  `031_Feature_内部日用版.md`: 139 unit/UI, 115 integration, 38 desktop/mobile
  browser checks, empty-database forward migration, verified backup, restart
  persistence, and real-mode readiness all passed on 2026-08-11. Seven
  explicitly gated live-message checks were skipped and are not counted as
  passed.
- Verification for the Live-only digital-life revision is recorded in
  `003_Feature_语音专属数字生命.md`.
- Interface-quality decisions and evidence are recorded in
  `004_Feature_界面质感精修.md`.
- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`: passed
  on 2026-08-06.
- `npm run test:e2e`: 6 of 6 checks passed across `1440x900` and `390x844` on
  2026-08-06, including exact Live-orb dimensions, no homepage orb, overflow,
  console, and reduced-motion behavior.
- After the interface-quality pass, `npm run test:e2e` increased to 8 of 8
  passing checks, adding desktop navigation placement and `320x568` minimum
  touch-target coverage.
- The cinematic-presence revision increases browser acceptance to 10 checks.
  It adds desktop/mobile full-bleed canvas dimensions, nonblank pixel energy,
  pointer-driven pixel change, Live scene-state transitions, and the honest
  local-only message state.
- The centered-conversation revision keeps 10 browser checks and replaces the
  canvas probes with original-resolution backdrop loading, viewport coverage,
  exact desktop centering, conversation submission, Live switching, mobile
  touch targets, overflow, console, and reduced-motion coverage.
- Production browser console: zero errors and zero warnings.
- Backend and persistent-conversation verification on 2026-08-06: lint, type
  checking, and production build passed; 12 of 12 unit/UI checks, 17 of 17
  database/service/HTTP checks, and 10 of 10 desktop/mobile Playwright checks
  passed. PostgreSQL 17 reported healthy on `127.0.0.1:55432`. Full evidence is
  recorded in `008_Feature_真实文字对话.md`.
- YOS integration evidence on 2026-08-06: seven adapter contract checks, four
  runtime selection checks, one startup-loader check, one PostgreSQL YOS fixture
  path, one real local YOS marked reply, one full Yoyoo route persistence round
  trip, and a real browser inspection passed. Final gates reported 25 unit/UI,
  18 fixture/database/HTTP integration, and 10 desktop/mobile browser checks;
  the three separately enabled live checks passed. Details and remaining
  limitations are recorded in `009_Feature_YOS真实接入.md`.
- Controlled YOS acceptance on 2026-08-06 added two adapter regressions and two
  explicitly gated live resilience checks. Ten of ten sequential marker turns
  passed. A real delayed reply at about 128 seconds justified increasing the
  default response window from 120 to 180 seconds. A reproduced stale-reply
  misassociation failed before ordered channel draining and passed afterward
  against a fresh production build.
- Homepage and conversation separation: implemented on 2026-08-06. `/` now
  stays concise and never expands the transcript; `/conversation` owns the
  full-height scrolling timeline, bottom composer, retry, stop, and Live entry.
  No dashboard cards or fabricated priority data were introduced. Fresh gates
  passed 27 unit/UI checks, 18 default integration checks, production build,
  and 12 desktop/mobile browser checks.
- V0.2 targeted evidence on 2026-08-07: runtime selection and room UI checks
  passed; the real YOS adapter smoke test passed in 14.11 seconds; the real YOS
  collaboration-room test passed in 9.14 seconds and proved a completed reply
  persisted in the authoritative room snapshot. Final all-suite counts are
  recorded in `011_Feature_多人多AI协作房间.md`.
- V0.2 final gate on 2026-08-07: lint and TypeScript passed; 42 of 42 unit/UI
  checks passed; 29 of 29 default PostgreSQL integration checks passed with 4
  explicitly gated live checks skipped by default; production build passed;
  16 of 16 Playwright checks passed across desktop and mobile projects.
- V0.3 targeted checks on 2026-08-07: 16 of 16 Codex adapter and runtime
  selection checks passed, including real child-process timeout, abnormal exit,
  output cap, and stderr sanitization paths. The explicitly enabled Codex + YOS
  room test passed in 250.02 seconds and covered Codex-only, YOS-only, parallel,
  and PostgreSQL restoration paths.
- V0.3 final gate on 2026-08-07: lint and TypeScript passed; 53 of 53 unit/UI
  checks passed; 29 of 29 default PostgreSQL integration checks passed with 5
  explicitly gated real-service checks skipped by default; production build
  passed; 16 of 16 Playwright checks passed across desktop and mobile. The
  npm production dependency audit against the official registry found 0 known
  vulnerabilities.
- V0.4 targeted checks on 2026-08-07: 27 of 27 contract, selector, Codex, and
  YOS adapter checks passed; 4 of 4 repository checks proved room isolation,
  trigger ordering, context budgets, and atomic delegation settlement.
- V0.4 real Codex/YOS acceptance passed in 378.77 seconds. Each Agent generated
  an unknown marked fact, the other recovered it from room history, both then
  replied in parallel, and all marked replies were restored after reopening the
  server runtime.
- V0.4 browser acceptance passed 16 of 16 checks across desktop and mobile.
  The collaboration case now waits for the current run set and current Artifact
  counts instead of incorrectly accepting matching records from old history.
- V0.5 final gate on 2026-08-07: lint, TypeScript, and production build passed;
  59 of 59 unit/UI checks passed; 34 of 34 default PostgreSQL integration checks
  passed with 5 explicitly gated external-service checks skipped by default;
  18 of 18 Playwright checks passed across desktop and mobile. Browser coverage
  includes room creation, switching, URL restoration, message isolation, mobile
  navigation, overflow, and the existing multi-Agent workflow.
- V0.6 final gate on 2026-08-07: lint, TypeScript, and production build passed;
  63 of 63 unit/UI checks passed; 38 of 38 default PostgreSQL integration checks
  passed with 5 explicitly gated external-service checks skipped by default;
  20 of 20 Playwright checks passed across desktop and mobile. Browser coverage
  includes lifecycle history preservation and all prior multi-room regressions.
  Full evidence is recorded in `015_Feature_房间管理与长对话.md`.
- V0.7 final gate on 2026-08-08: lint, TypeScript, and production build passed;
  66 of 66 unit/UI
  checks passed; 42 of 42 default PostgreSQL/HTTP integration checks passed
  with 5 explicitly gated external-service checks skipped; 20 of 20 Playwright
  checks passed across desktop and mobile. Manual browser inspection found zero
  console errors or warnings. Full evidence is recorded in
  `016_Feature_房间详情与成员管理.md`.
- V0.8 final gate on 2026-08-08: four migration checks, lint, TypeScript, and
  production build passed; 71 of 71 unit/UI checks passed; 56 of 56 default
  PostgreSQL/HTTP integration checks passed with 6 explicitly gated external
  service checks skipped; 22 of 22 Playwright checks passed across desktop and
  mobile. Manual `1440x900` and `390x844` inspection found zero console errors
  or warnings. After explicit user consent, a real YOS Gateway room turn
  completed with a unique marker, survived a Yoyoo runtime restart, and the
  bridge recovered its heartbeat. Full evidence is recorded in
  `017_Feature_Agent_Gateway与真实AI接入.md`.
- V0.9 / IM-1 final gate on 2026-08-10: lint, TypeScript, and production build
  passed; 120 of 120 unit/UI checks passed; 108 of 108 default PostgreSQL/HTTP/
  Gateway/AI Card integration checks passed with 7 explicitly gated external
  checks skipped by default; 32 of 32 Playwright checks passed across desktop
  and mobile. The separately enabled real YOS Gateway suite passed 2 of 2: YOS
  read a uniquely marked authorized private text file, its reply was persisted,
  and credential revocation denied the next resource read. A full browser run
  also reproduced and closed a stale old-room event race before final acceptance.
  Phase evidence is recorded in `021` through `026` feature records.
- V0.10 final local gate on 2026-08-10: lint, TypeScript, and production build
  passed; 125 of 125 unit/UI checks passed; 115 of 115 default PostgreSQL/HTTP/
  Gateway/AI Card integration checks passed with 7 explicitly gated external
  live checks skipped by default; 32 of 32 Playwright checks passed across
  desktop and mobile. Review hardening also proves conflicting idempotency
  payloads return `409`, inactive workspace or Principal membership cannot
  authorize Agent delivery or mentions, the final visible room cannot be hidden,
  empty workspaces remain recoverable, and room actions work by pointer,
  keyboard, and touch long-press. Manual `1440x900` production inspection found
  no console errors, no horizontal overflow, a floating room menu, and a working
  details pane with canonical room ID and owner-editable purpose. Full evidence
  is recorded in `027_Feature_ID寻址与会话列表.md`.
- V0.11 final local gate on 2026-08-11: lint, TypeScript, and production build
  passed; 132 of 132 unit/UI checks passed; 115 of 115 default PostgreSQL/HTTP/
  Gateway/AI Card integration checks passed with 7 explicitly gated external
  live checks skipped by default; 38 of 38 Playwright checks passed across
  desktop and mobile. Manual `1440x900`, `1024x768`, `390x844`, and `320x568`
  inspection found no horizontal overflow or control overlap, and the production
  preview console reported zero errors and warnings. Full evidence is recorded
  in `028_Feature_无背景双主题视觉系统.md`.
- V0.12 final local gate on 2026-08-11: lint, TypeScript, and production build
  passed; 133 of 133 unit/UI checks passed; 115 of 115 default PostgreSQL/HTTP/
  Gateway/AI Card integration checks passed with 7 explicitly gated external
  live checks skipped by default; 38 of 38 Playwright checks passed across
  desktop and mobile. The design detector reported zero issues. Production
  screenshots covered light and dark `1440x900`, the responsive details pane,
  and dark `390x844` without horizontal overflow or composer overlap. Full
  evidence is recorded in `029_Feature_旗舰对话界面.md`.
- V0.13 final local gate on 2026-08-11: the shared navigation and conversation
  frame now use one semantic optical-glass system across light and dark themes,
  while the timeline and messages remain opaque reading surfaces. Impeccable
  reported zero issues; lint, TypeScript, and production build passed; 133 of
  133 unit/UI checks passed; 115 of 115 default integration checks passed with
  7 explicitly gated external checks skipped; and 38 of 38 desktop/mobile
  Playwright checks passed. Production screenshots covered light/dark
  `1440x900`, dark `390x844`, and the details pane. Full evidence is recorded
  in `030_Feature_光学毛玻璃材质系统.md`.
- V0.15 public preview was approved and locally completed on 2026-08-12 on an
  isolated feature branch. Its deployment target is `https://app.yoyooai.com` with one
  pre-provisioned human owner, permanent sequential AI Card IDs beginning at
  `AI_100001`, password login, revocable server sessions, complete private-route
  authorization, persistent production data, and a recoverable deployment.
  Public registration, multi-human UX, social login, SMS/email delivery, and
  production rollout remain outside the completed local gate; production still
  requires its explicit host, DNS, backup, and rollback approval.
- Production demo Agent cleanup completed on 2026-08-12. Image
  `yoyoo-space:c4159af` starts with `YOYOO_BUILTIN_AGENTS=none`; exact-ID cleanup
  removed only the three empty demo Principals and their six workspace/room
  membership rows. Two restarts retained 2 Principals, 1 room, 1 owner member,
  and 0 Agents. HTTPS/SNI acceptance returned health `200`, anonymous workspace
  `401`, login `200`, 1 room, and 0 Agents. Full evidence and rollback locations
  are recorded in `033_Feature_公网演示Agent清理.md`.
- Lighthouse scores of 99/100/100 belong to the previous homepage version and
  were not reused as evidence for this redesign.
