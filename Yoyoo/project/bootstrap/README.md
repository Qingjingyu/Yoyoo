# Yoyoo Employee Bootstrap

This folder defines Yoyoo 1.0.1 employee activation baseline.

## Zero-Config Entry (Recommended)

For end users, run from repo root:

```bash
bash install.sh
```

It will prompt for `MINIMAX_API_KEY` (if not set), then activate **single mode** automatically:
- one Gateway (`:18789`)
- CEO as `main`
- CTO as `cto` agent under the same Gateway

## Goal
Any new employee activated from Git should get the same default stack:
- OpenClaw 2026.2.15 (pinned baseline)
- MiniMax provider config
- QMD backend
- base skills
- role profile
- gateway health baseline
- Yoyoo backend long-task kernel (retry + resume)
- CEO private chat + group chat shared memory session

Default architecture baseline:
- `single`: one Gateway + multi-agent routing (recommended, install default)
- `dual`: CEO + CTO dual instance (optional compatibility mode)

## Quick Start
On server (root):

```bash
git clone -b master git@github.com:Qingjingyu/Yoyoo.git
cd Yoyoo
export MINIMAX_API_KEY='your_key'
export YOYOO_ROLE='ceo'   # ceo | ops | cto | rd-director(legacy) | rd-engineer
bash Yoyoo/project/bootstrap/activate_employee.sh
```

## One-Click: Activate CEO + CTO (Dual Mode)

Use this when you want the default dual-agent setup in one command:

```bash
git clone -b master git@github.com:Qingjingyu/Yoyoo.git
cd Yoyoo
export MINIMAX_API_KEY='your_key'
bash Yoyoo/project/bootstrap/activate_ceo_cto.sh
```

This script activates:
- CEO: `/root/.openclaw` on `:18789`
- CTO: `/root/.openclaw-cto` on `:18794`
- Team mode defaults:
  - CEO is primary dialogue entry.
  - CTO is execution owner.
  - CEO/CTO share core memory (`MEMORY.md + memory/`) to avoid session split.
  - Default task routing policy is written to `TEAM_ROUTING.md`.

Optional:
- `YOYOO_RUN_ACCEPTANCE=0` to skip acceptance check.
- `YOYOO_TEAM_SHARED_MEMORY=0` to disable shared memory wiring.
- `YOYOO_TEAM_SHARED_USER=0` to keep `USER.md` independent.

## One-Click: Configure Single Gateway Team (Default)

When `install.sh` runs with default `YOYOO_MODE=single`, it performs:
1) activate CEO instance via `activate_employee.sh` (`ceo`, `:18789`)
2) configure CTO agent (`cto`) under the same Gateway via:
   - `configure_single_gateway_agents.sh`

Manual run:

```bash
export YOYOO_HOME=/root/.openclaw
export YOYOO_PROFILE=yoyoo-ceo
bash Yoyoo/project/bootstrap/configure_single_gateway_agents.sh
```

Package manager support in `activate_employee.sh`:
- Debian/Ubuntu: `apt-get`
- Alibaba/RHEL/Fedora/CentOS: `dnf` / `yum`

No manual fake `apt-get` wrapper is required.

## Python Runtime Baseline (Server)

For `Yoyoo/project/backend`, use Python 3.11+ explicitly.
Some cloud images still map `python3` to 3.6, which will break backend dependency install.

Recommended on server:

```bash
python3.11 --version
cd Yoyoo/project/backend
python3.11 -m venv .venv311
.venv311/bin/pip install -U pip setuptools wheel
.venv311/bin/pip install -i https://pypi.org/simple \
  "fastapi>=0.115,<1.0" \
  "uvicorn[standard]>=0.32,<1.0" \
  "pydantic>=2.8,<3.0" \
  "httpx>=0.28,<1.0" \
  "pytest>=8.3,<9.0" \
  "ruff>=0.8,<1.0"
```

If your environment has internal mirror issues, enforce pypi:

```bash
export PIP_INDEX_URL="https://pypi.org/simple"
```

## Instance Isolation (Important)
Employee activation now defaults to isolated OpenClaw instances by role, to avoid overwriting CEO config:

- `ceo` -> `YOYOO_HOME=/root/.openclaw`, `OPENCLAW_PORT=18789`
- `ops` -> `YOYOO_HOME=/root/.openclaw-ops`, `OPENCLAW_PORT=18790`
- `cto` -> `YOYOO_HOME=/root/.openclaw-cto`, `OPENCLAW_PORT=18794`
- `rd-director` -> `YOYOO_HOME=/root/.openclaw-rd-director`, `OPENCLAW_PORT=18791`
- `rd-engineer` -> `YOYOO_HOME=/root/.openclaw-rd-engineer`, `OPENCLAW_PORT=18793`

For non-CEO roles, the script blocks shared CEO instance by default. If you really need to share one instance (not recommended), set:

```bash
export YOYOO_ALLOW_SHARED_INSTANCE=1
```

## Per-Employee Isolation (Recommended)

From this version, activation enables strict isolation by default (`YOYOO_ENABLE_STRICT_ISOLATION=1`):

- one employee = one Linux service user
- one employee = one isolated runtime root (default `/srv/yoyoo/<employee_key>/`)
- one employee = one isolated OpenClaw state/workspace/backup path
- services run with least-privilege user, not shared root state

You can create multiple employees under the same role by setting `YOYOO_EMPLOYEE_KEY`:

```bash
export MINIMAX_API_KEY='your_key'
export YOYOO_ROLE='ops'
export YOYOO_EMPLOYEE_KEY='ops-xiaoguang'
bash Yoyoo/project/bootstrap/hire_employee_from_git.sh
```

For custom employee keys, prefer `hire_employee_from_git.sh` / `hire_employee_safe.sh` (it auto-allocates a free port).
If you directly call `activate_employee.sh`, set `OPENCLAW_PORT` explicitly to avoid port collisions.

Mapping:
- role default key (`ceo`, `ops`, `cto`, `rd-director`, `rd-engineer`) keeps legacy paths/ports for compatibility.
- custom `employee_key` uses isolated runtime root:
  - `YOYOO_HOME=/srv/yoyoo/<employee_key>/state`
  - `YOYOO_WORKSPACE=/srv/yoyoo/<employee_key>/workspace`
  - service: `openclaw-gateway-<employee_key>.service`

Optional:
- `YOYOO_FORCE_OPENCLAW_INSTALL=1` to force reinstall pinned OpenClaw version (`YOYOO_OPENCLAW_VERSION`, default `2026.2.15`).
- `YOYOO_ENABLE_BACKEND_KERNEL=0` to skip backend kernel install (not recommended).

## Feishu Unified Session (CEO default)

For CEO role, activation now enables:
- `session.scope=global` in `openclaw.json`
- Feishu group-session patch via `patch_openclaw_feishu_session.sh`

This prevents memory split between Feishu group and DM for the same employee.
`yoyoo_doctor.sh` and `setup_guard.sh` also verify and auto-heal this setting.

## Hire directly from Git

```bash
export MINIMAX_API_KEY='your_key'
export YOYOO_ROLE='ceo'
bash Yoyoo/project/bootstrap/hire_employee_from_git.sh
```

`hire_employee_from_git.sh` inherits the same isolation defaults and exports `YOYOO_HOME` + `OPENCLAW_PORT` automatically.
It now auto-stashes local runtime changes by default before pull (`YOYOO_GIT_AUTO_STASH=1`).
Default branch ref is now `master` (`GIT_REF` can still be overridden manually).

## Recommended: Safe Hire Wrapper

Use one command to hire a new employee with enforced isolation + post-checks:

```bash
bash Yoyoo/project/bootstrap/hire_employee_safe.sh ops
bash Yoyoo/project/bootstrap/hire_employee_safe.sh ops ops-xiaoguang
```

What it guarantees:
- Applies role-specific isolation defaults (`YOYOO_HOME`, `OPENCLAW_PORT`, profile, systemd unit).
- Executes `hire_employee_from_git.sh` with `YOYOO_ALLOW_SHARED_INSTANCE=0`.
- Verifies both:
  - new employee instance is healthy
  - CEO instance (`/root/.openclaw`, `:18789`) is still healthy
- Runs acceptance check by default for `ceo + new role` (set `YOYOO_RUN_ACCEPTANCE=0` to skip).

Supported roles:
- `ops`
- `cto`
- `rd-director`
- `rd-engineer`

## Git Rollback (New)

`setup_guard.sh` now installs:
- doctor timer (2 min)
- asset backup timer (default 10 min)
- asset git snapshot timer (default 5 min)
- rollback helper script per employee

Example rollback helper path:

```bash
/usr/local/bin/yoyoo-asset-rollback-<employee_key>.sh --list
/usr/local/bin/yoyoo-asset-rollback-<employee_key>.sh --to <commit>
```

This allows fast rollback after bad prompts, mis-ops, or broken config changes, without touching other employees.

## One-Click Acceptance

Run this after any config/deploy/hiring change:

```bash
bash Yoyoo/project/bootstrap/acceptance_check.sh
```

Optional auto-clean for orphan reserved ports (for example, stale `18793` listener):

```bash
AUTO_CLEAN_ORPHAN_PORT=1 bash Yoyoo/project/bootstrap/acceptance_check.sh
```

Checks included:
- Gateway/channel probe per existing role instance.
- CEO Feishu unified-session guard (`session.scope=global` + patch verify).
- Auth profile integrity (`minimax` + `anthropic` with non-empty key).
- Reserved role-port ownership audit (including `18793`) with process source.
- Legacy drift guard: checks old `18792`, but treats it as healthy when it is co-listened by the same CEO gateway PID.
- Recent critical log signatures:
  - `No API key found for provider "anthropic"`
  - `unknown option '--model'`
- Task progress watchdog (new):
  - default nudge: no progress for 90s
  - default degrade: no progress for 300s (mark failed + require reassignment)

## Files
- `activate_employee.sh`: one-step activation.
- `activate_ceo_cto.sh`: one-step activation for CEO + CTO dual-agent baseline.
- `configure_single_gateway_agents.sh`: add/repair CTO agent for single-gateway team mode.
- `qmd_enable.sh`: enable QMD memory backend.
- `install_base_skills.sh`: install default skills.
- `setup_guard.sh`: install doctor timer + backup timer + git snapshot timer + rollback helper.
- `task_progress_watchdog.sh`: detect stalled running tasks and auto nudge/degrade.
- `hire_employee_from_git.sh`: pull repo and activate employee.
- `hire_employee_safe.sh`: safe role-isolated hire + CEO/non-CEO health verification.
- `acceptance_check.sh`: one-click acceptance checks (probe/session/auth/log signatures).
- `profiles/*`: role identity/soul/memory/contract templates.
- `registry/capability-catalog.yaml`: baseline/optional capability governance.
