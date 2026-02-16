# Yoyoo Operations Runbook

## Scope
This runbook covers Yoyoo 1.0 day-to-day operations on production servers.

## 1) Pre-Deploy Checklist
Run before any install/upgrade:

```bash
bash scripts/preflight.sh
```

Expected:
- required commands exist (`git`, `curl`, `jq`)
- deployment ports are visible
- OpenClaw pinned version is readable from `install.sh`

## 2) Deploy

```bash
# standard install (auto-activate CEO + CTO)
bash install.sh
```

If you only want baseline files (no activation):

```bash
YOYOO_SKIP_AUTO_ACTIVATE=1 bash install.sh
```

## 3) Post-Deploy Verification

```bash
bash scripts/post_deploy_check.sh
```

This checks:
- systemd units
- gateway ports
- OpenClaw channel probe
- backend health endpoints

## 4) Routine Health
- `systemctl status openclaw-gateway.service --no-pager`
- `systemctl status openclaw-gateway-cto.service --no-pager`
- `ss -lntp | grep -E '18789|18794|8000|8004'`
- `bash Yoyoo/project/bootstrap/acceptance_check.sh`

## 5) Incident Handling
If response quality drops or service stops:
1. Run `bash scripts/post_deploy_check.sh`
2. Run `openclaw doctor --fix`
3. Re-run acceptance check
4. If still broken, rollback to last stable tag

## 6) Rollback

```bash
ROLLBACK_CONFIRM=YES bash scripts/rollback_to_tag.sh <tag> master
```

Rollback runs acceptance checks automatically if available.

## 7) Branch Protection (one-time repo admin action)

```bash
bash scripts/set_branch_protection.sh master
```

