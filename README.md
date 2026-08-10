# Yoyoo Space

Yoyoo Space is a shared workspace for humans and AI Agents. Its foundation
supports multiple human and Agent principals; V0.9 exposes a daily-usable IM
slice: one human collaborating with multiple independently addressable Agents
across persistent group and direct rooms. The repository is a clean
implementation started on 2026-08-05 and does not inherit the retired Yoyoo
application or Git history.

Current status: the accepted concise homepage remains unchanged. The dedicated
collaboration room now supports private file upload, preview and download,
message and filename search, room file history, replies, revision-safe edits,
soft retraction, unread counts, per-room drafts and reading position, and stable
human/Agent direct rooms. Explicit Agent routing, parallel runs, typed
delegation, intervention, retry, persisted Artifacts, and bounded room history
remain intact. PostgreSQL is authoritative across refresh and room switching;
ordered run events stream over SSE. Private bytes live behind an opaque local
BlobStore and are authorized on every browser or Agent read. The provider-
neutral Agent Gateway and AI Card runtime paths receive run-scoped attachment
descriptors rather than local paths or permanent URLs. The product still does
not include public-user authentication, visible multi-human invitation,
external push notifications, semantic document/OCR search, production object
storage, malware scanning, or hard deletion.

## Requirements

- Node.js 24 or newer.
- npm 11 or newer.
- Docker Desktop with Docker Compose for the local PostgreSQL service.
- A locally installed and authenticated Codex CLI for `dev:yos` mode. Run
  `codex login status` to verify the existing ChatGPT login.

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

## External Agent Gateway

Open `http://127.0.0.1:3000/settings/agents`, create an AI identity, and retain
the one-time credential. To connect the local YOS service through the public
Gateway contract, add these values to `.env.local`:

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

Store the result only as `YOYOO_AICARD_SESSION_SECRET` in `.env.local`. Open
`http://localhost:4173/settings/agents` and choose `接入 AI Card`. AI Card then
shows only active AI identities controlled by the signed-in human. After one is
approved, Yoyoo creates or reuses one stable local Agent Principal, activates
its workspace membership, and shows it as `等待运行节点`. Yoyoo stores
only the stable pairwise identity mapping; the authorization code, PKCE
verifier, access token, and refresh token are not persisted.

Use `连接我的身份` only to bind the current human owner. `兼容接入` creates a
legacy `yya_` Gateway credential for existing runtime bridges.

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

## Reference Policy

- The retired Yoyoo source is stored outside this repository as a read-only
  snapshot for protocol archaeology only.
- Glass UI React is an AGPL reference and no source from it may be imported.
- Owned cinematic design-system code may be selectively reused only when the
  implementation plan identifies the file and tests the resulting behavior.
- The fluid orb is adapted from SmoothUI's MIT-licensed Siri Orb. Attribution
  and the original license are preserved in `THIRD_PARTY_NOTICES.md`.
- The current homepage uses a user-provided Yoyoo backdrop. The earlier
  Three.js chamber remains outside the rendered route while this composition is
  evaluated and does not enter the homepage bundle.
