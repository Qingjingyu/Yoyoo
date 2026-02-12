PYTHON ?= $(if $(wildcard .venv/bin/python),.venv/bin/python,python3)
PIP := $(PYTHON) -m pip
PYTEST ?= $(if $(wildcard .venv/bin/pytest),.venv/bin/pytest,$(PYTHON) -m pytest)
RUFF ?= $(if $(wildcard .venv/bin/ruff),.venv/bin/ruff,$(PYTHON) -m ruff)
UVICORN ?= $(if $(wildcard .venv/bin/uvicorn),.venv/bin/uvicorn,$(PYTHON) -m uvicorn)
YYOS_DIR ?= ../../../YYOS

.PHONY: install dev test lint format
.PHONY: baseline archive-memory memory-maintenance release-check daily-eval smoke-full-stack release-prod-check
.PHONY: yyos-check yyos-bootstrap skill-audit

install:
	$(PIP) install -e ".[dev]"

dev:
	$(UVICORN) app.main:app --reload --host 0.0.0.0 --port 8000

test:
	$(PYTEST)

lint:
	$(RUFF) check .

format:
	$(RUFF) format .

baseline:
	$(PYTHON) scripts/replay_baseline.py --cases ./baseline/chat_regression_cases.json

archive-memory:
	$(PYTHON) scripts/archive_memory_daily.py \
		--memory-file $${MEMORY_FILE:-./data/yoyoo_memory.json} \
		--archive-dir $${ARCHIVE_DIR:-./data/archive} \
		--keep-days $${KEEP_DAYS:-14}

memory-maintenance:
	$(PYTHON) scripts/memory_maintenance.py \
		--memory-file $${MEMORY_FILE:-./data/yoyoo_memory.json} \
		--archive-dir $${ARCHIVE_DIR:-./data/archive} \
		--report-dir $${REPORT_DIR:-./data/reports} \
		--keep-days $${KEEP_DAYS:-14}

release-check:
	bash scripts/release_check.sh

daily-eval:
	$(PYTHON) scripts/daily_eval_and_rebalance.py \
		--memory-file $${MEMORY_FILE:-./data/yoyoo_memory.json} \
		--report-dir $${REPORT_DIR:-./data/reports}

smoke-full-stack:
	bash scripts/smoke_full_stack.sh

release-prod-check:
	bash deploy/yoyoo-release-check.sh

yyos-check:
	@command -v yyos >/dev/null
	yyos --json >/dev/null
	@echo "yyos ok"

yyos-bootstrap:
	cd $(YYOS_DIR) && python3 skills/yyos/scripts/bootstrap_stack.py apply --target all --json

skill-audit:
	$(PYTHON) scripts/skill_audit.py --allowlist ./config/skill_allowlist.json --blocklist ./config/skill_blocklist.json
