from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.api.team import router as team_router
from app.container import build_container

app = FastAPI(title="Yoyoo Backend", version="1.0.5")
app.include_router(team_router)

_WEB_DIR = Path(__file__).resolve().parent / "web"
if _WEB_DIR.exists():
    app.mount("/web", StaticFiles(directory=_WEB_DIR, html=True), name="web")


@app.on_event("startup")
def _on_startup() -> None:
    app.state.container = build_container()


@app.get("/")
def root() -> RedirectResponse:
    if _WEB_DIR.exists():
        return RedirectResponse(url="/web/")
    return RedirectResponse(url="/healthz")


@app.get("/healthz")
def healthz() -> dict[str, bool]:
    return {"ok": True}
