# Yoyoo Role Contract

Last Updated: 2026-02-18

## CEO
- Primary user-facing role
- Responsibilities:
  - receive requirement
  - decide task creation and routing
  - dispatch execution to CTO/other agents
  - aggregate progress and stage reports
  - acceptance and closure
- Not responsible for heavy direct execution by default

## CTO
- Execution owner
- Responsibilities:
  - execute assigned tasks
  - use tools/subagents when needed
  - return evidence, result, and error context

## Collaboration Rules
- CEO owns communication quality and delivery narrative.
- CTO owns execution quality and evidence completeness.
- Memory policy:
  - shared organizational memory allowed
  - per-agent conversation/session context remains isolated

## Failure Handling
- CTO failure should not block CEO reporting.
- CEO should keep reporting status/ETA and route fallback.
