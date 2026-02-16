# Yoyoo Upgrade Policy

## Baseline Principle
Yoyoo 1.0 uses a **pinned OpenClaw baseline**:
- `2026.2.15` for install and employee activation

This avoids version drift between:
- OpenClaw core
- skills/memory behavior
- bootstrap scripts

## Upgrade Trigger
Only upgrade baseline when at least one is true:
1. Security fix required
2. Critical bug fix needed for production
3. New feature required by Yoyoo roadmap

## Upgrade Process
1. Update pinned version in:
   - `install.sh`
   - `Yoyoo/project/bootstrap/activate_employee.sh`
2. Run local verification:
   - shell syntax checks
   - backend tests
   - acceptance check on test server
3. Merge to `master`
4. Tag release (`v1.0.x`)
5. Validate production with `scripts/post_deploy_check.sh`

## Rollback Rule
If production checks fail after upgrade:
1. rollback to previous stable tag
2. freeze new rollout
3. open incident doc with root cause and prevention

## What must stay stable
- default branch ref in hire scripts = `master`
- no `openclaw@latest` in baseline scripts
- no hardcoded `/usr/bin/openclaw` in systemd template generation

