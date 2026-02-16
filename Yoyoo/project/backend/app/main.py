from __future__ import annotations

from fastapi import FastAPI

from app.api.team import router as team_router
from app.container import build_container

app = FastAPI(title="Yoyoo Backend", version="1.0.5")
app.include_router(team_router)


@app.on_event("startup")
def _on_startup() -> None:
    app.state.container = build_container()


@app.get("/healthz")
def healthz() -> dict[str, bool]:
    return {"ok": True}

