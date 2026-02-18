PYTHON ?= python3.11
VENV ?= $(firstword $(wildcard .venv .venv311) .venv311)
PIP := $(VENV)/bin/pip
PY := $(VENV)/bin/python
PYTEST := $(VENV)/bin/pytest
RUFF := $(VENV)/bin/ruff
UVICORN := $(VENV)/bin/uvicorn

BACKEND_URL ?= http://127.0.0.1:8000
LOAD_TOTAL ?= 20
LOAD_CONCURRENCY ?= 5

.PHONY: install dev test lint format load-test ops-report release-check release-prod-check

install:
	$(PYTHON) -m venv $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -e ".[dev]"

dev:
	$(UVICORN) app.main:app --host 127.0.0.1 --port 8000 --reload

test:
	PYTHONPATH=. $(PYTEST) -q

lint:
	$(RUFF) check .

format:
	$(RUFF) format .

load-test:
	PYTHONPATH=. $(PY) scripts/bridge_load_test.py \
		--base-url $(BACKEND_URL) \
		--total $(LOAD_TOTAL) \
		--concurrency $(LOAD_CONCURRENCY)

ops-report:
	PYTHONPATH=. $(PY) scripts/ops_daily_report.py --base-url $(BACKEND_URL)

release-check: lint test

release-prod-check: release-check
