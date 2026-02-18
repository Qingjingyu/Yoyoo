from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.api.team import router as team_router
from app.container import build_container

logger = logging.getLogger(__name__)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, minimum: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        parsed = int(raw)
    except ValueError:
        return default
    return max(parsed, minimum)


async def _watchdog_loop(app: FastAPI) -> None:
    interval_sec = _env_int("YOYOO_WATCHDOG_INTERVAL_SEC", default=30, minimum=5)
    stale_progress_sec = _env_int("YOYOO_WATCHDOG_STALE_PROGRESS_SEC", default=90, minimum=30)
    stale_degrade_sec = _env_int("YOYOO_WATCHDOG_STALE_DEGRADE_SEC", default=300, minimum=60)
    recover_stale_sec = _env_int("YOYOO_WATCHDOG_RECOVER_STALE_SEC", default=120, minimum=30)
    recover_max_scan = _env_int("YOYOO_WATCHDOG_RECOVER_SCAN", default=50, minimum=1)
    recover_max_attempts = _env_int("YOYOO_WATCHDOG_RECOVER_ATTEMPTS", default=2, minimum=1)
    min_repeat_sec = _env_int("YOYOO_WATCHDOG_MIN_REPEAT_SEC", default=120, minimum=30)
    scan_limit = _env_int("YOYOO_WATCHDOG_SCAN_LIMIT", default=200, minimum=1)

    state = app.state.watchdog_state
    while True:
        started_at = datetime.now(UTC)
        try:
            container = app.state.container
            scan = container.ceo_dispatcher.watchdog_scan(
                stale_progress_sec=stale_progress_sec,
                stale_degrade_sec=stale_degrade_sec,
                max_scan=scan_limit,
                min_repeat_sec=min_repeat_sec,
            )
            recover = container.ceo_dispatcher.recover_stale_tasks(
                max_scan=recover_max_scan,
                stale_seconds=recover_stale_sec,
                max_attempts=recover_max_attempts,
            )
            state["enabled"] = True
            state["run_total"] = int(state.get("run_total", 0)) + 1
            state["last_ok"] = True
            state["last_error"] = None
            state["last_scan"] = scan
            state["last_recover"] = recover
            state["last_run_at"] = started_at.isoformat()
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover
            logger.exception("watchdog_loop_failed")
            state["run_total"] = int(state.get("run_total", 0)) + 1
            state["last_ok"] = False
            state["last_error"] = str(exc)
            state["last_run_at"] = started_at.isoformat()
        await asyncio.sleep(interval_sec)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.container = build_container()
    app.state.watchdog_state = {
        "enabled": False,
        "run_total": 0,
        "last_ok": None,
        "last_error": None,
        "last_run_at": None,
        "last_scan": None,
        "last_recover": None,
    }
    watchdog_task: asyncio.Task[None] | None = None
    if _env_bool("YOYOO_WATCHDOG_AUTORUN", default=True):
        watchdog_task = asyncio.create_task(_watchdog_loop(app))
    app.state.watchdog_task = watchdog_task
    yield
    task = app.state.watchdog_task
    if task is not None:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Yoyoo Backend", version="1.0.5", lifespan=lifespan)
app.include_router(team_router)

_WEB_DIR = Path(__file__).resolve().parent / "web"
if _WEB_DIR.exists():
    app.mount("/web", StaticFiles(directory=_WEB_DIR, html=True), name="web")


@app.get("/")
def root() -> RedirectResponse:
    if _WEB_DIR.exists():
        return RedirectResponse(url="/web/")
    return RedirectResponse(url="/healthz")


@app.get("/healthz")
def healthz() -> dict[str, bool]:
    return {"ok": True}
