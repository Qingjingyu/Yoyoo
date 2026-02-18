from __future__ import annotations

import os
from dataclasses import dataclass

from app.intelligence.ceo_dispatcher import CEODispatcher
from app.intelligence.memory import MemoryService
from app.services.agent_router import AgentRouter
from app.services.executor_adapter import ExecutorAdapter


@dataclass(slots=True)
class ServiceContainer:
    memory_service: MemoryService
    ceo_dispatcher: CEODispatcher
    agent_router: AgentRouter


def build_container() -> ServiceContainer:
    memory_file = os.getenv("YOYOO_MEMORY_FILE")
    memory = MemoryService(storage_path=memory_file)
    agent_router = AgentRouter.from_env()
    dispatcher = CEODispatcher(
        memory_service=memory,
        executor_adapter=ExecutorAdapter(),
    )
    return ServiceContainer(
        memory_service=memory,
        ceo_dispatcher=dispatcher,
        agent_router=agent_router,
    )
