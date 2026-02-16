# Yoyoo Employee Template

## Role Card
- Employee Key: `<employee_key>`
- Role: `ceo | cto | ops | rd-director | rd-engineer`
- State Dir: `/srv/yoyoo/<employee_key>/state` (default for custom key)
- Workspace Dir: `/srv/yoyoo/<employee_key>/workspace`
- Gateway Unit: `openclaw-gateway-<employee_key>.service`
- Gateway Port: auto-allocated (custom key) or role default

## Onboarding Checklist
1. Activate employee:
   ```bash
   MINIMAX_API_KEY=*** \
   YOYOO_ROLE=ops \
   YOYOO_EMPLOYEE_KEY=ops-<name> \
   bash Yoyoo/project/bootstrap/hire_employee_safe.sh ops ops-<name>
   ```
2. Confirm service health and probe pass.
3. Confirm memory path is isolated.
4. Confirm employee can report progress and final result to CEO.

## Memory and Asset Rules
- Employee memory is private by default.
- Shared decisions must be summarized to CEO namespace.
- Backups and git snapshots must remain enabled (`setup_guard.sh`).

## Security Rules
- No hardcoded secrets in scripts/docs.
- No cross-employee state reuse unless explicitly allowed.
- All production changes must pass quality-gate workflows.

## Acceptance Evidence Template
When employee closes a task, include:
- command/output evidence
- runtime health result
- rollback note (if any)
- final “CEO digest” summary

