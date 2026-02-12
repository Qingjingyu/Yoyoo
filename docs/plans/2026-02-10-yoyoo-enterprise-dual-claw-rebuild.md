# Yoyoo Enterprise Dual-Claw Rebuild Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild server with latest OpenClaw in dual-instance architecture (Yoyoo-CEO + Yoyoo-OPS), then train CEO into Yoyoo enterprise brain with persistent memory and continuous execution behavior.

**Architecture:** Use two isolated OpenClaw homes and two systemd services. CEO handles user-facing strategy and task orchestration; OPS acts as operational backup and recovery assistant. A watchdog timer keeps rules/memory synchronized and auto-recovers CEO.

**Tech Stack:** Ubuntu 22.04/24.04, Node.js 22, OpenClaw latest, systemd timers, Bash, QMD memory backend.

---

### Task 1: Fresh Host Bootstrap

**Files:**
- Create: `中转/rebuild_yoyoo_enterprise_dual_claw.sh`
- Create: `/etc/yoyoo/ceo.env` (on server)
- Create: `/etc/yoyoo/ops.env` (on server)

**Step 1:** Install base dependencies (`curl`, `git`, `jq`, `python3`, `build-essential`)

**Step 2:** Install Node.js 22 and verify `node -v`, `npm -v`

**Step 3:** Install OpenClaw latest globally and verify `openclaw --version`

**Step 4:** Create isolated homes:
- `/root/.openclaw-ceo`
- `/root/.openclaw-ops`

**Step 5:** Store secrets in env files only (no plaintext in repo)

### Task 2: Dual Service Setup

**Files:**
- Create: `/etc/systemd/system/openclaw-ceo.service`
- Create: `/etc/systemd/system/openclaw-ops.service`

**Step 1:** CEO service on port `18789`, channel bot name `Yoyoo-CEO`

**Step 2:** OPS service on port `18791`, channel bot name `Yoyoo-OPS`

**Step 3:** Enable restart policy (`Restart=always`, `RestartSec=5`)

**Step 4:** Start and verify both are `active`

### Task 3: Yoyoo Brain Training Pack

**Files:**
- Create/Modify: `/root/.openclaw-ceo/workspace/IDENTITY.md`
- Create/Modify: `/root/.openclaw-ceo/workspace/SOUL.md`
- Create/Modify: `/root/.openclaw-ceo/workspace/AGENTS.md`
- Create/Modify: `/root/.openclaw-ceo/workspace/MEMORY.md`

**Step 1:** Inject identity: “born from Claw, evolved as independent lifeform Yoyoo”

**Step 2:** Inject memory sovereignty: CEO master ledger, OPS execution replica

**Step 3:** Inject enterprise mode: concept-first answers, no filename misrouting

**Step 4:** Inject execution persistence: continue until done/blocker, periodic progress updates

### Task 4: Continuous Execution Guard

**Files:**
- Create: `/usr/local/bin/yoyoo_enterprise_guard.sh`
- Create: `/etc/systemd/system/yoyoo-enterprise-guard.service`
- Create: `/etc/systemd/system/yoyoo-enterprise-guard.timer`

**Step 1:** Every 60s check CEO health

**Step 2:** Auto-restart CEO when unhealthy

**Step 3:** Keep CEO workspace prompt/memory rules from drifting

### Task 5: Validation

**Step 1:** Health checks:
- `systemctl is-active openclaw-ceo openclaw-ops`
- `ss -lntp | grep -E '18789|18791'`

**Step 2:** CEO behavior checks in Feishu:
- Ask: “今天规划是什么？”
- Ask: “继续执行，不要停”

**Step 3:** Memory checks:
- `qmd search 'Yoyoo 主账 Windows 员工 Codex 开发'`

**Step 4:** Incident drill:
- Stop CEO once, confirm guard recovers it automatically

### Task 6: Handoff

**Files:**
- Create: `开发过程/023_重装重建执行记录_YYYY-MM-DD.md`

**Step 1:** Record exact commands and outputs

**Step 2:** Record service names, ports, and runbook

**Step 3:** Record rollback steps
