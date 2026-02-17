from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.api.team import router as team_router
from app.container import build_container


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.container = build_container()
    yield


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
