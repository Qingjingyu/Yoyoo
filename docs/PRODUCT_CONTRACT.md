# Yoyoo Product Contract (SSOT)

Last Updated: 2026-02-18

## One-Line Definition
Yoyoo is an AI employee system where the user talks to CEO, while CTO and other agents execute work and report progress.

## Default Architecture (Authoritative)
- Default mode: `single`
- Runtime shape: one Gateway + multiple agents
- Core roles:
  - CEO (`main`): intake, dispatch, acceptance, reporting
  - CTO (`cto`): execution owner

## Optional Architecture
- `dual` mode is supported only as an optional compatibility/fault-isolation deployment.
- `dual` is **not** the default product posture.

## Installation Contract
- `bash install.sh` => `YOYOO_MODE=single` by default
- `YOYOO_MODE=dual bash install.sh` => optional dual-instance activation

## Consistency Rule
Any change to installation behavior must update:
1) `README.md`
2) `Yoyoo/project/bootstrap/README.md`
3) `Yoyoo/project/backend/README.md`
4) This file (`docs/PRODUCT_CONTRACT.md`)
