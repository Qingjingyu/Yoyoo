# Yoyoo Release Notes v1.0.5

Date: 2026-02-18  
Release Head: `85a3097` (origin/master validation baseline)  
Backend Version: `1.0.5`

## Summary
- OpenClaw upgraded to `2026.2.17` and verified running.
- Gateway auto-start enabled (LaunchAgent loaded/running).
- Feishu channel health is `ON / OK`.
- Memory search (QMD/vector) is ready.

## Validation Evidence
- Backend lint: `ruff check .` -> passed
- Backend tests: `pytest -q` -> `22 passed`
- Bootstrap scripts syntax: `bash -n` on `Yoyoo/project/bootstrap/*.sh` -> passed
- Runtime checks:
  - `openclaw --version` -> `2026.2.17`
  - `openclaw status` -> gateway reachable, service running

## Scope Included In This Release
- Backend API and execution orchestration stability improvements.
- Bootstrap/doctor/guard script hardening.
- Team mode and dispatch-related test coverage expansion.

## Known Notes
- `origin/master` currently does not include `Yoyoo/project/install_minimax.sh`.
- Current local workspace contains large untracked frontend template directories; they are intentionally excluded from release commit scope.

## Rollback / Safety
- OpenClaw pre-update backup:
  - `/Users/subai/openclaw_backups/openclaw_preupdate_20260218_222953.tgz`

