PYTHON ?= python3.11
VENV ?= $(firstword $(wildcard .venv .venv311) .venv311)
PIP := $(VENV)/bin/pip
PYTEST := $(VENV)/bin/pytest
RUFF := $(VENV)/bin/ruff
UVICORN := $(VENV)/bin/uvicorn

.PHONY: install dev test lint format release-check release-prod-check

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

release-check: lint test

release-prod-check: release-check
