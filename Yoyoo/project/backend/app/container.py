from __future__ import annotations

import os
from dataclasses import dataclass

from app.intelligence.ceo_dispatcher import CEODispatcher
from app.intelligence.memory import MemoryService


@dataclass(slots=True)
class ServiceContainer:
    memory_service: MemoryService
    ceo_dispatcher: CEODispatcher


def build_container() -> ServiceContainer:
    memory_file = os.getenv("YOYOO_MEMORY_FILE")
    memory = MemoryService(storage_path=memory_file)
    dispatcher = CEODispatcher(memory_service=memory)
    return ServiceContainer(memory_service=memory, ceo_dispatcher=dispatcher)

