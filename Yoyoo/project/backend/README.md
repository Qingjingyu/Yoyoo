# Yoyoo Backend (Bootstrap)

Minimal FastAPI backend bootstrap for restarting implementation work.

## Structure

```text
backend/
  app/
    intelligence/
      brain.py
      policy_guard.py
      memory.py
      planner.py
      model_router.py
      verification.py
    services/
      openclaw_adapter.py
    main.py
    schemas.py
  tests/
    test_api.py
    test_memory.py
    test_brain.py
  pyproject.toml
  Makefile
```

## Quick Start

```bash
cd Yoyoo/project/backend
python3.11 -m venv .venv311
source .venv311/bin/activate
make install
make dev
```

Service runs at `http://127.0.0.1:8000`.
Independent Web console (MVP) is available at `http://127.0.0.1:8000/web/`.

If `make install` fails due editable-install/build backend issues, use fallback install:

```bash
export PIP_INDEX_URL="https://pypi.org/simple"
pip install -U pip setuptools wheel
pip install \
  "fastapi>=0.115,<1.0" \
  "uvicorn[standard]>=0.32,<1.0" \
  "pydantic>=2.8,<3.0" \
  "httpx>=0.28,<1.0" \
  "pytest>=8.3,<9.0" \
  "ruff>=0.8,<1.0"
```

## Useful Commands

```bash
make install # install dependencies
make dev     # run backend on :8000
make test   # run pytest
make lint   # run ruff
make format # format with ruff
make release-check      # lint + test
make release-prod-check # same as release-check for current bootstrap
```

## DingTalk Runtime Guard

Server-side runtime guard scripts:

```bash
# 1) one-click check (window = 5 minutes)
/root/yoyoo/backend/scripts/yoyoo_dingtalk_check.sh 5

# 2) no-message guard (uses env in /etc/yoyoo/backend.env)
/root/yoyoo/backend/scripts/yoyoo_dingtalk_guard.sh
```

Recommended timer unit (run every minute):

```bash
systemctl enable --now yoyoo-dingtalk-guard.timer
journalctl -u yoyoo-dingtalk-guard.service -n 50 --no-pager
```

Guard behavior (production defaults):
- No inbound messages but forwarder heartbeat is alive: `OK idle_healthy` (no alert push).
- Alert push is only triggered on real faults:
  - forwarder/backend service inactive, or
  - stream heartbeat missing within guard window.

## Current APIs

- `GET /healthz`: service health check
- `GET /api/v1/ops/health`: ops snapshot + alert evaluation
- `GET /api/v1/ops/alerts`: alert-only view
- `GET /api/v1/ops/failures`: failed task attribution + prevention suggestions (default recent 24h, with 7d baseline summary)
- `POST /api/v1/chat`: mock chat endpoint
- `POST /api/v1/dingtalk/events`: DingTalk event ingress endpoint (MVP loop)
- `POST /api/v1/team/tasks`: CEO 接单并只派单给 CTO（CEO 不直接执行）
  - 返回 `cto_lane` 与 `execution_mode`（`subagent` / `employee_instance`）
- `POST /api/v1/team/tasks/{task_id}/progress`: 仅接受 CTO 进度回报，CEO 转述给用户
- `POST /api/v1/team/tasks/{task_id}/result`: 仅接受 CTO 结果提交，CEO 验收并汇报
- `GET /api/v1/team/tasks/{task_id}`: 查询任务卡与阶段时间线
  - 明细包含 `cto_lane` 与 `execution_mode`
- `GET /api/v1/team/tasks?user_id=...`: 按用户查询任务列表（支持 `channel`/`limit`）
- `POST /api/v1/team/watchdog/scan`: 后端主动扫描卡住任务（超时催办/降级）
- `GET /api/v1/tasks/{conversation_id}`: query task ledger for a conversation
- `GET /api/v1/traces/{trace_id}`: query trace-linked events and tasks
- `POST /api/v1/tasks/{task_id}/feedback`: submit human feedback (`good`/`bad`) for learning
  - You can also give feedback in chat directly, e.g. `这次做得很好` / `这次不行`.
- In DingTalk, replying/quoting a task message containing `task_id` will auto-bind feedback to that task.
  - Quoted message ID mapping is supported; user does not need to see or type `task_id`.

## Yoyoo Intelligence Layer (v0.4)

Current backend includes an intelligence middle layer:
- **Brain** (`app/intelligence/brain.py`): unified orchestration entry
- **Policy Guard** (`app/intelligence/policy_guard.py`): risky-text blocking and group mention gating
- **Memory** (`app/intelligence/memory.py`): layered memory with profile facts, daily notes, conversation summaries, and task ledger (file persistence)
- **Task Planner** (`app/intelligence/planner.py`): SOP-style step planning for task requests
- **Model Router** (`app/intelligence/model_router.py`): intent-based model profile routing
- **Research Playbook** (`app/intelligence/research_playbook.py`): maps tasks to internal research references
- **Task Verifier** (`app/intelligence/verification.py`): acceptance checklist + rollback template
- **OpenClaw Adapter** (`app/services/openclaw_adapter.py`): delegates execution to configured bridge endpoint
- **YYOS Orchestrator** (`app/intelligence/yyos_orchestrator.py`): optional orchestration hints (risk/stage/skills), Yoyoo remains final decision maker

P1 upgrades:
- End-to-end `trace_id` propagation for `/api/v1/chat` and `/api/v1/dingtalk/events`.
- Task ledger lifecycle: `planned -> completed/failed` with evidence and executor feedback.
- Memory context pack for reply planning (`summary_points`, recent tasks, today notes).
- Relevance-based memory retrieval for autonomous planning (`summary/task/event` mixed ranking).
- Learning loop v1: task outcomes are aggregated into strategy hints (timeout/failure/success patterns).
- Learning scope v2: learning stats are segmented by `user + channel + project`.
- P3-A quality governance: execution reply scoring + automatic correction retry for low-quality outputs.
- P3-B strategy cards: learning results are promoted into reusable `StrategyCard` objects.
- P3-C planning upgrade: template task decomposition, default evidence collection, read-only-first guard for risky tasks.
- P4 human feedback loop: manual `good/bad` feedback updates scoped learning and strategy cards.
- P4.1 weighted feedback: feedback uses time-decayed weight, so recent evaluations affect planning more.

Team mode default routing:
- CEO responsibilities: intake, dispatch, progress follow-up, user reporting.
- CTO responsibilities: all execution (small task via subagent, large task via employee instance).
- Non-CTO progress/result submissions are rejected by API.

Environment options:

```bash
export YOYOO_TRUSTED_USER_IDS="17351488265762046"
export DINGTALK_SIGNATURE_SECRET="your-secret"
export DINGTALK_CLIENT_ID="your-client-id"
export DINGTALK_CLIENT_SECRET="your-client-secret"
export DINGTALK_SEND_TIMEOUT_SEC="8"
export YOYOO_MEMORY_FILE="./data/yoyoo_memory.json"
export OPENCLAW_BRIDGE_URL="http://127.0.0.1:18080/bridge/chat"
export OPENCLAW_BRIDGE_TOKEN="optional-token"
export OPENCLAW_BRIDGE_RETRIES="0"
export OPENCLAW_BRIDGE_TIMEOUT_SEC="20"
export OPENCLAW_BRIDGE_SESSION_STRATEGY="conversation"
export OPENCLAW_BRIDGE_SESSION_LOCK_RETRIES="1"
export OPENCLAW_LOCAL_EXEC="1"
export OPENCLAW_EXEC_TIMEOUT_SEC="45"
export OPENCLAW_FALLBACK_TO_SSH_ON_LOCAL_FAILURE="1"
export OPENCLAW_LOCAL_HEALTHCHECK_TTL_SEC="60"
export OPENCLAW_CIRCUIT_BREAKER_FAILURE_THRESHOLD="5"
export OPENCLAW_CIRCUIT_BREAKER_OPEN_SEC="30"
export OPENCLAW_SESSION_STRATEGY="conversation"
export OPENCLAW_SESSION_LOCK_RETRIES="1"
export OPENCLAW_RETRY_POLICY_FILE="/root/yoyoo/backend/config/retry_policy.json"
export OPENCLAW_RETRY_POLICY_RELOAD_SEC="5"
export OPENCLAW_SSH_HOST="115.191.36.128"
export OPENCLAW_SSH_USER="root"
export OPENCLAW_SSH_KEY_PATH="/path/to/miyaodui.pem"
export OPENCLAW_SSH_PORT="22"
export OPENCLAW_REMOTE_OPENCLAW_BIN="openclaw"
export YOYOO_MEMORY_SIDECAR_ENABLED="0"
export YOYOO_MEMORY_SIDECAR_URL="http://127.0.0.1:8787"
export YOYOO_MEMORY_SIDECAR_TOKEN=""
export YOYOO_MEMORY_SIDECAR_TIMEOUT_SEC="3"
export YOYOO_MEMORY_SIDECAR_RETRIEVE_PATH="/api/v1/retrieve"
export YOYOO_YYOS_ENABLED="1"
export YOYOO_YYOS_BIN="yyos"
export YOYOO_YYOS_TIMEOUT_SEC="8"
export YOYOO_ALERT_RECOVERY_COUNT_WARN="3"
export YOYOO_ALERT_FEEDBACK_MIN_ATTEMPTS="20"
export YOYOO_ALERT_FEEDBACK_MIN_SUCCESS_RATE="0.9"
export YOYOO_ALERT_FEEDBACK_MAX_NOT_FOUND_RATE="0.2"
export YOYOO_ALERT_MEMORY_MIN_STRATEGY_CARDS="5"
export YOYOO_ALERT_MEMORY_MAX_LOW_PERFORMANCE_RATE="0.35"
```

Daily evaluation loop:

```bash
cd Yoyoo/project/backend
make daily-eval
# optional dry-run
python3 scripts/daily_eval_and_rebalance.py --dry-run
python3 scripts/memory_maintenance.py --dry-run
```

Optional: enable daily automation via systemd timer:

```bash
cp deploy/yoyoo-daily-eval.service /etc/systemd/system/
cp deploy/yoyoo-daily-eval.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now yoyoo-daily-eval.timer
systemctl list-timers --all | grep yoyoo-daily-eval
```

Optional: enable memory maintenance timer:

```bash
cp deploy/yoyoo-memory-maintenance.service /etc/systemd/system/
cp deploy/yoyoo-memory-maintenance.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now yoyoo-memory-maintenance.timer
systemctl list-timers --all | grep yoyoo-memory-maintenance
```

Optional: install/update DingTalk forwarder service (journald logging):

```bash
cp deploy/yoyoo-dingtalk-forwarder.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now yoyoo-dingtalk-forwarder.service
systemctl status yoyoo-dingtalk-forwarder.service --no-pager
```

Execution routing priority:
1) `OPENCLAW_BRIDGE_URL` configured -> call HTTP bridge (if failed continue fallback).
2) If `OPENCLAW_LOCAL_EXEC=1` -> run local healthcheck then execute local `openclaw agent --json`.
3) If local failed and SSH fallback enabled -> run recovery probe then execute `openclaw agent --json` via SSH.
4) If SSH timeout occurs -> retry SSH once automatically.
5) For `dingtalk/api` channel hints, adapter maps to OpenClaw `last` channel for compatibility.
6) If session lock (`*.jsonl.lock`) appears, adapter/bridge retries once with a new session id.
7) Otherwise -> fallback to local mock chat reply.

YYOS integration behavior:
1) On task requests, Yoyoo optionally calls local `yyos --json` for orchestration hints.
2) Yoyoo only consumes hint fields (`stage`, `risk_level`, `decision`, `skills`) and keeps final planning authority.
3) YYOS hints are written into `evidence_structured` as `yyos_routing` (or `yyos_routing_error`).
4) If YYOS is unavailable, Yoyoo degrades gracefully without blocking OpenClaw execution.

Memory sidecar behavior (optional):
1) Enable via `YOYOO_MEMORY_SIDECAR_ENABLED=1`.
2) Pipeline calls sidecar when local context is sparse or task intent requires richer memory.
3) Sidecar failures do not block replies; metrics are still recorded in `memory_quality`.
4) Built-in sidecar app entry: `app/services/memory_sidecar_http.py` (`POST /api/v1/retrieve`).
5) Production service template: `deploy/yoyoo-memory-sidecar.service` (listen `127.0.0.1:8787`).
6) Startup health includes sidecar flags: `startup_self_check.memory_sidecar_enabled/available`.

Optional HTTP bridge service (recommended for productionized routing):
- App entry: `app/services/openclaw_http_bridge.py`
- Listen: `127.0.0.1:18080`
- Endpoint: `POST /bridge/chat`, `GET /healthz`
- Systemd template: `deploy/openclaw-http-bridge.service`

## One-click Deploy (Server)

Use local script to deploy backend to server with probes:

```bash
bash Yoyoo/project/scripts/deploy_yoyoo_backend_oneclick.sh
```

What it does:
1. Syncs `Yoyoo/project/backend` to `/root/yoyoo/backend`.
2. Installs runtime dependencies and creates `yoyoo-backend.service`.
3. Runs probes:
   - health check
   - duplicate event dedupe
   - restart + dedupe persistence
4. Prints key ops metrics (`task_intake_total`, `duplicate_dropped_total`, `dedupe_hit_rate`).

Optional overrides:

```bash
YOYOO_DEPLOY_HOST=115.191.36.128 \
YOYOO_DEPLOY_USER=root \
YOYOO_DEPLOY_SSH_KEY=/path/to/key.pem \
bash Yoyoo/project/scripts/deploy_yoyoo_backend_oneclick.sh
```

Load test mode:
- Default (`YOYOO_P0_LOAD_TEXT=你好，压测`) validates channel ingress + dedupe quickly.
- If you want task-path pressure test, override:

```bash
YOYOO_P0_LOAD_COUNT=20 \
YOYOO_P0_LOAD_TEXT='请执行一个部署任务并反馈 #' \
bash Yoyoo/project/scripts/deploy_yoyoo_backend_oneclick.sh
```

Retry policy supports hot reload from JSON file (`OPENCLAW_RETRY_POLICY_FILE`):

```json
{
  "rules": {
    "local:timeout": {
      "run_recovery_probe": true,
      "allow_ssh_fallback": true
    },
    "ssh:timeout": {
      "ssh_retries": 2
    }
  }
}
```

Server troubleshooting (OpenClaw):
- Ensure default model is MiniMax:
  `openclaw models set minimax/MiniMax-M2.1`
- If browser control fails with `Failed to start Chrome CDP on port 18800`,
  check Chromium snap dependency:
  `snap tasks <change_id>` and `snap connections chromium | grep gpu-2404`
- For headless servers, set:
  `openclaw config set browser.headless true --json`
  `openclaw config set browser.noSandbox true --json`

DingTalk outbound:
- If inbound payload contains `sessionWebhook`, backend sends reply directly to DingTalk via this URL.
- Configure `DINGTALK_CLIENT_ID` and `DINGTALK_CLIENT_SECRET` to attach `x-acs-dingtalk-access-token`.

## P0 Cutover (DingTalk -> Yoyoo -> OpenClaw)

Recommended on the OpenClaw server (same host deployment):

1. Run Yoyoo backend with:
```bash
export OPENCLAW_LOCAL_EXEC="1"
export OPENCLAW_REMOTE_OPENCLAW_BIN="openclaw"
```

2. Start DingTalk forwarder:
```bash
NODE_PATH=/root/.openclaw/extensions/dingtalk/node_modules \
  node scripts/dingtalk_stream_forwarder.cjs
```

3. Disable direct DingTalk handling in OpenClaw to avoid double replies:
```bash
openclaw config set channels.dingtalk.enabled false --json
openclaw config set plugins.entries.dingtalk.enabled false --json
openclaw gateway restart
```

4. Verify single path:
- Send one DingTalk message
- Confirm backend logs hit `/api/v1/dingtalk/events`
- Confirm Yoyoo response includes planning metadata

Request example:

```json
{
  "user_id": "u_001",
  "message": "hello"
}
```

DingTalk event example:

```json
{
  "eventType": "chat_message",
  "eventId": "evt_001",
  "senderStaffId": "staff_001",
  "conversationId": "conv_001",
  "text": {
    "content": "你好"
  }
}
```

Optional signature validation:

```bash
export DINGTALK_SIGNATURE_SECRET="your-secret"
```

## Traceability

- Every request gets a `trace_id` (request header `x-trace-id` is accepted or generated).
- Response header `x-trace-id` always returns the active trace.
- Chat/DingTalk response body includes `trace_id`; task responses include `task_id`.
- Task responses include observability fields: `strategy_cards`, `execution_quality_score`, `execution_quality_issues`, `execution_corrected`.
- `/api/v1/tasks/{conversation_id}` and `/api/v1/traces/{trace_id}` include task quality and correction metadata.
- Task query responses also include feedback fields: `human_feedback`, `feedback_note`, `feedback_updated_at`.
