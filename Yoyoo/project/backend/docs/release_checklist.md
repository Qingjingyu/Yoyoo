# Release Checklist (Frozen Baseline)

## 1. Static Checks
- `make lint`
- `make test`
- `make yyos-check` (when `YOYOO_YYOS_ENABLED=1`)
- `make skill-audit`

## 2. Baseline Replay
- `make baseline`
- Ensure output contains `baseline replay passed`.

## 3. Ops Health
- `curl -s http://127.0.0.1:8000/api/v1/ops/health | python3 -m json.tool`
- Confirm:
  - `memory.persistence.last_save_ok = true`
  - `alert_status != critical`
  - `startup_self_check.yyos_enabled = true` and `startup_self_check.yyos_available = true` (if YYOS enabled)
  - If `YOYOO_MEMORY_SIDECAR_ENABLED=1`, verify sidecar process health:
    `curl -s http://127.0.0.1:8787/healthz | python3 -m json.tool`

## 4. Alerts
- `curl -s http://127.0.0.1:8000/api/v1/ops/alerts | python3 -m json.tool`
- If there are warnings, include cause + mitigation in release notes.

## 4.1 Failures Attribution
- `curl -s http://127.0.0.1:8000/api/v1/ops/failures | python3 -m json.tool`
- Confirm top categories and prevention suggestions are actionable.

## 5. Memory Archive (Weekly or Daily)
- `make archive-memory KEEP_DAYS=14`
- Confirm `archived_task_count` and generated archive file path.

## 6. One-Command Gate
- `make release-check`
- For deployed instance, use:
  - `CHECK_HTTP=1 BASE_URL=http://127.0.0.1:8000 make release-check`
