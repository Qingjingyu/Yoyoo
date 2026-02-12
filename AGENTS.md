# Repository Guidelines

## Project Structure & Module Organization
This repository is documentation-first. Primary content lives under `Yoyoo/`:
- `Yoyoo/soul/`: identity, behavior, and operating principles (`SOUL.md`, `USER.md`, `AGENTS.md`).
- `Yoyoo/docs/`: product specs, architecture notes, and development plans.
- `Yoyoo/research/`: external research and implementation notes.
- `Yoyoo/project/`: deployment notes and implementation workspace.
- `Yoyoo/project/backend/`: FastAPI bootstrap (`app/`, `tests/`, `pyproject.toml`, `Makefile`).
- `Yoyoo/BRAIN/MEMORY/`: long-term project evolution records.

Supporting folders:
- `开发过程/`: milestone/process notes.
- `中转/`: local transfer files (do not commit new secrets).

## Build, Test, and Development Commands
Commands:
- `rg --files Yoyoo` - index project documents.
- `cd Yoyoo/project/backend && make install` - install backend dependencies.
- `cd Yoyoo/project/backend && make dev` - run FastAPI on `:8000`.
- `cd Yoyoo/project/backend && make test` - run backend tests.
- `cd Yoyoo/project/backend && make lint` - run Ruff.
- `bash -n Yoyoo/project/install_minimax.sh` - validate installer script syntax.
- `bash Yoyoo/project/install_minimax.sh` - run deployment installer on target Ubuntu server as `root`.
- `openclaw doctor --fix` - repair OpenClaw config.

## Coding Style & Naming Conventions
- Use Markdown with concise sections and actionable headings.
- Keep filenames descriptive; existing patterns include uppercase snake case for core specs (`YOYOO_PRODUCT_DESIGN.md`).
- Python code should follow PEP 8 with 4-space indentation and type hints on public functions.
- API modules should stay under `app/` and tests under `tests/`, with names like `test_<feature>.py`.
- Shell scripts should use `#!/usr/bin/env bash`, fail-fast options (`set -euo pipefail` for new scripts), quoted variables, and explicit paths.
- Never hardcode new credentials or tokens in committed files.

## Testing Guidelines
- Backend tests use `pytest` + `fastapi.testclient`.
- For script changes: run `bash -n` and, if available, `shellcheck`.
- For backend changes: run `cd Yoyoo/project/backend && make test` before opening a PR.
- For deployment changes: verify runtime logs (for example, gateway startup lines in `/tmp/gateway.log`).

## Commit & Pull Request Guidelines
Git history is not included in this workspace snapshot, so follow Conventional Commit style going forward:
- `docs: ...`, `chore: ...`, `feat: ...`, `fix: ...`

PRs should include:
- Scope summary and changed paths.
- Validation steps/commands run and key output.
- Linked issue or task reference.
- Security check confirming no secrets/keys were added.

## Security & Configuration Tips
- Treat files like `中转/miyaodui.pem` as local-only secrets.
- Prefer environment variables or external secret stores for credentials.
- Redact tokens, passwords, and host access details from shared documentation.
