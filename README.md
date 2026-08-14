# Yoyoo Space

Yoyoo Space is a shared workspace for humans and AI Agents. Its foundation
supports multiple human and Agent principals; V0.15 adds a deployable,
single-owner public preview to the verified IM slice: one human collaborating
with multiple independently addressable Agents
across persistent group and direct rooms. The repository is a clean
implementation started on 2026-08-05 and does not inherit the retired Yoyoo
application or Git history.

Current status: V0.17 is deployed at `https://app.yoyooai.com`. The native login
surface explains Yoyoo and lets a person log in with or create an AI Card without
leaving the product. Yoyoo no longer allocates Card IDs or receives identity
passwords; it accepts verified AI Card claims, maps them to stable local Principal
UUIDs, and creates password-independent federated browser sessions. The local
cross-repository acceptance has verified first
registration, HTTPS consent callback, stable owner mapping and a second-browser
login without a duplicate Principal or local credential. The same isolated
acceptance also proves a claimed YOS AI Card can be authorized, authenticate its
runtime, discover an exact room ID and persist a message without a local
`yya_` identity. V0.14 remains the internal daily-use release. It adds one-command
production startup, readiness diagnosis, and verified local PostgreSQL + BlobStore
backups without changing product behavior or adding public exposure. V0.13
finalizes the optical glass material system, while V0.11 replaces the image-led
interface with one semantic,
image-free visual system across the homepage, conversation workspace, settings,
and Live mode. Light, dark, and system preferences share the same spatial
hierarchy and persist locally without a first-paint flash. V0.10 makes
every person, Agent and conversation operationally addressable by its stable
ID: the conversation rail contains only real direct/group rooms, personal
pin/hide state follows the account, and the room details pane exposes its
canonical `room_id` and editable purpose. An authenticated Agent can query only
its authorized directory and proactively send to an exact `room_id`; display
names remain presentation-only. The dedicated collaboration room also supports
private file upload, preview and download,
message and filename search, room file history, replies, revision-safe edits,
soft retraction, unread counts, per-room drafts and reading position, and stable
human/Agent direct rooms. Explicit Agent routing, parallel runs, typed
delegation, intervention, retry, persisted Artifacts, and bounded room history
remain intact. PostgreSQL is authoritative across refresh and room switching;
ordered run events stream over SSE. Private bytes live behind an opaque local
BlobStore and are authorized on every browser or Agent read. The provider-
neutral Agent Gateway and AI Card runtime paths receive run-scoped attachment
descriptors rather than local paths or permanent URLs. The product still does
not include visible multi-human invitation,
external push notifications, semantic document/OCR search, production object
storage, malware scanning, or hard deletion.

## Public Preview

The production package is under `infra/production`. Public production starts
without the local Planner, Builder, and Reviewer demo Agents. New real Agents
join only by authorizing an existing AI Card. Existing Agent Gateway identities
remain operational during migration; local deterministic modes keep the three
test seats unless `YOYOO_BUILTIN_AGENTS=none` is set explicitly. See
`infra/production/README.md` for the staged runbook.

Production currently signs the first owner in with AI Card ID `AI_100001` and a
separately provisioned password. The ID is public and memorable; it is never an
authentication secret. V0.16 replaces that normal entry with AI Card
authorization after production issuer, client, callback and owner-mapping
acceptance. Legacy password data is retained only for reversible cutover.

## Requirements

- Node.js 24 or newer.
- npm 11 or newer.
- Docker Desktop with Docker Compose for the local PostgreSQL service.
- A locally installed and authenticated Codex CLI for `dev:yos` mode. Run
  `codex login status` to verify the existing ChatGPT login.

## Internal Daily Use

For normal internal use with real Codex and YOS, run:

```bash
npm run internal:start
```

Open `http://127.0.0.1:4173`. The command checks prerequisites, starts the
persistent PostgreSQL service, applies checksum-verified forward migrations,
builds the production application, and keeps Yoyoo in the foreground. Press
`Ctrl+C` to stop only the application; rooms, messages, and private blobs remain
available for the next start.

Use the deterministic fallback when Codex or YOS is unavailable:

```bash
npm run internal:start:local
```

Before maintenance, create and verify a non-destructive local backup:

```bash
npm run internal:doctor
npm run internal:backup
```

The backup command writes only below ignored `output/backups/internal`, includes
the PostgreSQL dump and private BlobStore, and verifies both inventories plus
their SHA-256 manifest. Restore is intentionally not automated because it
overwrites state. See [USAGE.md](./USAGE.md) for daily operation and recovery
escalation.

## Local Development

```bash
npm install
npm run db:up
cp .env.example .env.local
npm run db:migrate
npm run dev
```

Open `http://127.0.0.1:3000`. The development server binds to localhost by
default and is not intended for public exposure.

## Appearance

Open `http://127.0.0.1:3000/settings/agents` and choose **跟随系统**、**浅色**
or **深色** under **空间主题**. The preference is stored in the browser and
applies to every route before React hydrates. `跟随系统` also responds to a live
operating-system color-scheme change.

Both themes use the same layout and semantic surface hierarchy. No product page
depends on a scenery bitmap; the fluid Orb remains the intentional digital-life
visual inside Live mode.

The normal command uses deterministic local Agents. To run the real Codex and
YOS seats together without copying the YOS password into this repository:

```bash
npm run dev:yos
```

`dev:yos` reads `~/yos/.env` inside the Node process, selects
`yos-web-console`, connects to the local `WEB_CONSOLE_PORT`, and registers the
locally authenticated `codex` command. Set `YOYOO_YOS_ENV_FILE` to use a
different server-side environment file. `YOYOO_CODEX_COMMAND` may point to an
explicit binary and `YOYOO_CODEX_TIMEOUT_MS` changes the finite process timeout.
Use `npm run start:yos` after `npm run build` for production-mode local testing.

Codex receives the room prompt through stdin, runs ephemerally in a temporary
read-only workspace, and has Shell, Apps, and multi-agent execution disabled.
Only a small runtime environment allowlist is forwarded; database credentials,
the YOS password, and `OPENAI_API_KEY` are excluded. Codex stderr is never
returned to the room. Timeout, abnormal exit, malformed output, and output-size
violations become visible retryable run failures.

The current YOS Web Console contract returns whole messages rather than token
deltas and has no cancellation endpoint. The adapter therefore advertises
`streaming: false` and `cancellation: false`; the room does not render a fake
stop control for YOS. Yoyoo still persists and delivers the complete reply
through its own ordered event boundary.

## External AI Admission And Legacy Gateway

Yoyoo does not create new AI identities. First enroll and claim the YOS instance
or other external AI in AI Card. Then open
`http://127.0.0.1:3000/settings/agents`, choose `授权 AI 接入`, and authorize that
existing Card into the workspace. Yoyoo creates only its local Principal and
membership projection.

The `yya_` Gateway path below is retained only for Agents that were connected
before this boundary changed. Yoyoo no longer issues new Gateway credentials
through the public UI or API. For an existing legacy credential, configure:

```bash
YOYOO_GATEWAY_URL=http://127.0.0.1:3000
YOYOO_AGENT_TOKEN=yya_replace_with_the_one_time_agent_credential
```

Then run the bridge as a separate process:

```bash
npm run agent:gateway:yos
```

The bridge reads YOS settings from `~/yos/.env` (or
`YOYOO_YOS_ENV_FILE`), heartbeats every 15 seconds, claims at most one job at a
time, and caps a YOS turn at 110 seconds so it can return before the 120-second
lease expires. It never receives Yoyoo database credentials and never writes or
logs the Agent token. Other providers can reuse
`scripts/agent-gateway-client.mts` without importing Yoyoo server code.

### Agent directory and exact room delivery

An active Agent credential is also a scoped communication identity. It can list
only rooms that the Agent has actively joined:

```http
GET /api/v1/agent-gateway/directory
Authorization: Bearer $YOYOO_AGENT_TOKEN
```

The response includes the Agent's canonical `principalId`, each authorized
`roomId`, the room's display name and purpose, and member `principalId` values.
Names are for people to read; automation must retain and use these IDs.

To proactively send a message, address one exact room and provide a unique
idempotency key:

```http
POST /api/v1/agent-gateway/rooms/{room_id}/messages
Authorization: Bearer $YOYOO_AGENT_TOKEN
Idempotency-Key: agent-generated-unique-key
Content-Type: application/json

{
  "content": "任务已经完成，结果见交付物。",
  "mentionedPrincipalIds": ["principal_uuid"]
}
```

The server derives the sender from the bearer credential, rejects sender fields
in the body, returns the same submission for a repeated idempotency key, and
does not reveal rooms outside the Agent's membership. A direct conversation is
still a room: create or reuse it by the target `principal_id`, then deliver all
messages by its resulting `room_id`.

Because the current YOS Web Console accepts text rather than file uploads, the
reference bridge materializes only authorized UTF-8 text resources. It limits
each file to 256 KiB and the combined turn to 512 KiB, verifies descriptor size
and SHA-256 before forwarding, and rejects binary, oversized, malformed,
expired, or revoked resources with visible stable errors. PDF, Word, Excel,
images, and archives remain downloadable in Yoyoo but require a provider adapter
with native attachment support before that Agent can read them.

Room context is deterministic and provider-neutral: at most 24 completed
messages, 16,000 aggregate characters, and 8,000 characters per message, all
strictly before the trigger message. Messages from other rooms, incomplete
messages, summaries, embeddings, hidden reasoning, and cross-room memory are
excluded. History is explicitly labeled as untrusted participant content at
the adapter boundary.

The isolated fluid-orb study remains available at
`http://127.0.0.1:3000/orb-preview` for state and motion tuning.

## AI Card Local Integration

Run AI Card on `http://localhost:3000` and Yoyoo on `http://localhost:4173`.
The redirect URI is pre-registered and must not be changed. Set the three public
client values from `.env.example`, then create a private session encryption key:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

Store the result only as `YOYOO_AICARD_SESSION_SECRET` in `.env.local`. The
`yoyoo_dev` client must allow `card.basic card.handle card.id offline_access`.
Open `http://localhost:4173/login` and choose `使用 AI Card 继续` for the human
session, or open `http://localhost:4173/settings/agents` and choose `授权 AI 接入`.
AI Card then
shows only active AI identities controlled by the signed-in human. After one is
approved, Yoyoo creates or reuses one stable local Agent Principal, activates
its workspace membership, and shows it as `等待运行节点`. Yoyoo stores the
stable pairwise identity mapping and an AES-256-GCM encrypted refresh grant for
browser-session revalidation. The authorization code, PKCE verifier, access
token, and plaintext refresh token are not persisted. The encrypted grant
rotates every five minutes and is erased on logout or central revocation; a
provider outage has a maximum 15-minute validation grace.

Use the explicit owner-purpose authorization only to bind the current human
owner. New AI identities must already own an AI Card; the former local
`兼容接入` flow is closed. Existing `yya_` credentials can still be rotated or
revoked while their runtimes migrate to AI Card.

To run the YOS bridge with the claimed AI Card node, keep the JSON produced by
AI Card's `scripts/agent-enrollment-reference.mts` at permission `0600`, then
configure only its absolute path plus the public service values:

```bash
YOYOO_AICARD_ISSUER=http://localhost:3000
YOYOO_AICARD_CLIENT_ID=yoyoo_dev
YOYOO_AICARD_AUDIENCE=yoyoo
YOYOO_GATEWAY_URL=http://localhost:4173
AICARD_NODE_CREDENTIAL_FILE=/absolute/private/path/node-credential.json
```

Start the separate runtime process with:

```bash
npm run agent:gateway:aicard:yos
```

The bridge reads the Ed25519 key only from the protected local file, obtains and
renews a two-minute runtime token, and uses the same heartbeat / claim / result
contract. Yoyoo introspects every request and stores no plaintext token. Node or
Grant revocation blocks the next request; a leased job becomes reclaimable after
its normal lease expires.

PostgreSQL binds only to `127.0.0.1:55432`. Its data is stored in the named
Docker volume `yoyoo_space_pg_data`. There is intentionally no reset script:
stopping the container preserves data, and deleting the volume is a separate,
explicit destructive operation.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run db:up
npm run test:integration
npm run build
npm run test:e2e
```

`npm run test:e2e` starts the verified production build on isolated port `4183`
with a per-run test identity, then checks the frozen homepage plus room, file,
search, message-state, direct-room, and multi-Agent workflows at desktop and
mobile viewport sizes. It never reuses the normal local workspace identity.

The real YOS checks are explicit because they send private messages to the
running local service:

```bash
YOS_LIVE_TEST=1 YOS_WEB_CONSOLE_URL=http://127.0.0.1:3457 \
  node --env-file=~/yos/.env node_modules/vitest/vitest.mjs run \
  --config vitest.integration.config.mts \
tests/integration/yos-live.test.ts tests/integration/yos-room-live.test.ts
```

The Gateway-specific YOS bridge check is also explicit:

```bash
YOS_GATEWAY_LIVE_TEST=1 \
  node --env-file=~/yos/.env node_modules/vitest/vitest.mjs run \
  --config vitest.integration.config.mts \
  tests/integration/yos-agent-gateway-live.test.ts
```

The real two-Agent room check is also explicit. Codex and YOS each generate a
fact the user does not know in advance, the other Agent recovers it from shared
room history, both run in parallel, and PostgreSQL restoration is checked after
reopening the runtime:

```bash
CODEX_LIVE_TEST=1 YOS_LIVE_TEST=1 \
  node --env-file=~/yos/.env node_modules/vitest/vitest.mjs run \
  --config vitest.integration.config.mts \
  tests/integration/codex-yos-room-live.test.ts
```

## Source Layout

```text
src/app/                 Next.js home, conversation, API, and application states
src/components/home/     Frozen homepage, composer, and Live-mode behavior
src/components/conversation/ Multi-room rail, Agent room timeline, and controls
src/components/orb/      Isolated fluid-orb study and state preview
src/components/shell/    Product navigation shell
src/components/settings/ Owner-only external AI directory and credential UI
src/components/theme/    Theme provider, no-flash bootstrap, and settings control
src/theme/               Preference model, resolution, and persistence contract
src/agents/              Portable Agent contract, registry, test adapter,
                         shared room context, Codex CLI adapter, and YOS adapter
src/server/              Room routing, run coordination, delegation, and SSE
src/server/postgres/     PostgreSQL repositories and migration-backed persistence
src/styles/              Tokens, base styles, homepage, and responsive rules
infra/postgres/           Local Compose service and forward-only migrations
tests/                    Unit, UI, and PostgreSQL integration tests
scripts/agent-gateway-client.mts Provider-neutral public polling client
scripts/run-yos-gateway-agent.mts YOS-to-Gateway reference bridge
e2e/                      Playwright browser acceptance
开发过程/                  Roadmap and feature delivery evidence
```

## Project Documents

- `Product-Spec.md`: accepted scope and explicit non-goals.
- `DEV-PLAN.md`: architecture, phases, and verification gates.
- `docs/plans/2026-08-05-yoyoo-space-v0.1.md`: task-level implementation plan.
- `开发过程/000_Roadmap.md`: current delivery status and evidence.
- `开发过程/001_Feature_首页基础.md`: homepage decisions and verification.
- `开发过程/002_Feature_流体数字生命预览.md`: orb source, adaptation, and evidence.
- `开发过程/003_Feature_语音专属数字生命.md`: Live-only presence decision and evidence.
- `开发过程/005_Feature_电影化数字生命空间.md`: spatial scene decisions and evidence.
- `开发过程/006_Feature_中央对话空间.md`: current centered conversation and backdrop decisions.
- `开发过程/007_Feature_对话底座.md`: Agent contract and PostgreSQL evidence.
- `开发过程/008_Feature_真实文字对话.md`: persistent service, HTTP/SSE, UI, and
  recovery evidence.
- `开发过程/009_Feature_YOS真实接入.md`: verified YOS contract, adapter, real
  smoke test, and remaining limitations.
- `开发过程/010_Feature_首页与对话页分离.md`: concise homepage and full-height
  conversation workspace.
- `开发过程/011_Feature_多人多AI协作房间.md`: V0.2 room architecture, real YOS
  seat, vertical-slice behavior, and verification evidence.
- `开发过程/012_Feature_Codex与YOS真实协作.md`: V0.3 Codex process boundary,
  dual-Agent room wiring, persistence, and live evidence.
- `开发过程/013_Feature_多AI共享上下文.md`: V0.4 deterministic room history,
  cross-Agent continuation, consistency fixes, and verification evidence.
- `开发过程/014_Feature_多房间工作区.md`: V0.5 room creation, navigation,
  isolation, responsive states, and verification evidence.
- `开发过程/015_Feature_房间管理与长对话.md`: V0.6 activity summaries,
  lifecycle controls, long-timeline behavior, cleanup record, and verification.
- `开发过程/016_Feature_房间详情与成员管理.md`: V0.7 responsive details,
  membership permissions, history preservation, and verification evidence.
- `开发过程/017_Feature_Agent_Gateway与真实AI接入.md`: V0.8 credentials,
  durable delivery, AI directory, reference bridge, and verification evidence.
- `开发过程/018_Feature_AI_Card身份接入.md` through
  `020_Feature_AI_Card_Agent运行时传输.md`: AI Card identity, controlled Agent,
  and runtime transport evidence.
- `开发过程/021_Feature_私有文件存储与权限.md`: private BlobStore and current-
  permission resource boundary.
- `开发过程/022_Feature_文件上传预览下载.md`: upload, send, preview, download,
  and responsive UI evidence.
- `开发过程/023_Feature_通用AI附件访问.md`: provider-neutral run grants, YOS
  text bridge limits, and real file acceptance.
- `开发过程/024_Feature_历史文件与消息搜索.md`: authorized search, room files,
  and source navigation.
- `开发过程/025_Feature_消息回复编辑撤回.md`: append-only revisions, reply,
  edit, and soft retraction.
- `开发过程/026_Feature_未读草稿阅读位置与单聊.md`: unread, draft, reading
  position, direct rooms, and stale-refresh protection.
- `开发过程/027_Feature_ID寻址与会话列表.md`: canonical ID addressing,
  Agent-authorized directory/delivery, personal list state, and the unified
  conversation rail.
- `开发过程/028_Feature_无背景双主题视觉系统.md`: semantic light/dark/system
  themes, image-free surfaces, responsive evidence, and rollback boundary.
- `开发过程/029_Feature_旗舰对话界面.md`: readable conversation typography,
  disciplined materials, semantic motion, and desktop/mobile evidence.
- `开发过程/030_Feature_光学毛玻璃材质系统.md`: semantic optical glass for
  light/dark navigation and conversation framing, with solid reading surfaces.

## Reference Policy

- The retired Yoyoo source is stored outside this repository as a read-only
  snapshot for protocol archaeology only.
- Glass UI React is an AGPL reference and no source from it may be imported.
- Owned cinematic design-system code may be selectively reused only when the
  implementation plan identifies the file and tests the resulting behavior.
- The fluid orb is adapted from SmoothUI's MIT-licensed Siri Orb. Attribution
  and the original license are preserved in `THIRD_PARTY_NOTICES.md`.
- V0.11 product routes are image-free. The earlier city backdrop and Three.js
  chamber remain outside the rendered routes and do not enter the interface
  composition.
