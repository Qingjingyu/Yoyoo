from __future__ import annotations

import re
from typing import Any

from app.intelligence.memory import MemoryService
from app.services.memory_sidecar import MemorySidecarClient


class MemoryPipeline:
    """Orchestrate memory context retrieval with lightweight dedupe and summary."""

    def __init__(
        self,
        *,
        memory_service: MemoryService,
        memory_sidecar: MemorySidecarClient | None = None,
    ) -> None:
        self._memory_service = memory_service
        self._memory_sidecar = memory_sidecar

    def build_context(
        self,
        *,
        conversation_id: str,
        user_id: str,
        channel: str,
        query: str,
        intent: str,
        project_key: str | None = None,
    ) -> dict[str, Any]:
        ingested_query = self._normalize_text(query)
        resolved_project_key = project_key or self._memory_service.infer_project_key(
            query=ingested_query,
            conversation_id=conversation_id,
        )
        context_pack = self._memory_service.build_context_pack(
            conversation_id=conversation_id,
            user_id=user_id,
            channel=channel,
            project_key=resolved_project_key,
            query=ingested_query,
            intent=intent,
        )
        relevant = context_pack.get("relevant_memories")
        relevant_memories = list(relevant) if isinstance(relevant, list) else []
        deduped_memories = self._dedupe_relevant_memories(relevant_memories)
        sidecar_used = False
        sidecar_success: bool | None = None
        sidecar_error: str | None = None
        sidecar_retrieved_count = 0
        sidecar_sufficient: bool | None = None
        needs_sidecar = (
            self._memory_sidecar is not None
            and self._memory_sidecar.enabled
            and (intent == "task_request" or len(deduped_memories) < 3)
        )
        if needs_sidecar:
            sidecar_used = True
            sidecar_result = self._memory_sidecar.retrieve(
                query=ingested_query,
                user_id=user_id,
                conversation_id=conversation_id,
                limit=5,
            )
            sidecar_success = sidecar_result.ok
            sidecar_error = sidecar_result.error
            sidecar_retrieved_count = len(sidecar_result.items)
            sidecar_sufficient = sidecar_result.sufficient
            if sidecar_result.items:
                deduped_memories = self._dedupe_relevant_memories(
                    deduped_memories + sidecar_result.items
                )
        sufficiency_passed = (
            bool(sidecar_sufficient)
            if isinstance(sidecar_sufficient, bool)
            else len(deduped_memories) >= 2
        )
        self._memory_service.record_memory_pipeline_metrics(
            retrieved_count=len(relevant_memories) + sidecar_retrieved_count,
            deduped_count=len(deduped_memories),
            sidecar_used=sidecar_used,
            sidecar_success=sidecar_success,
            sidecar_item_count=sidecar_retrieved_count,
            sufficiency_passed=sufficiency_passed,
        )
        context_pack["relevant_memories"] = deduped_memories
        context_pack["project_key"] = resolved_project_key
        context_pack["memory_pipeline"] = {
            "ingested_query": ingested_query,
            "retrieved_count": len(relevant_memories) + sidecar_retrieved_count,
            "local_retrieved_count": len(relevant_memories),
            "sidecar_retrieved_count": sidecar_retrieved_count,
            "sidecar_used": sidecar_used,
            "sidecar_ok": sidecar_success,
            "sidecar_error": sidecar_error,
            "sufficiency_passed": sufficiency_passed,
            "deduped_count": len(deduped_memories),
            "summary": self._summarize_memories(deduped_memories),
        }
        return context_pack

    def _dedupe_relevant_memories(self, memories: list[dict[str, Any]]) -> list[dict[str, Any]]:
        deduped: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in memories:
            if not isinstance(item, dict):
                continue
            text = self._normalize_text(str(item.get("text") or ""))
            if not text:
                continue
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
            deduped.append(item)
        return deduped

    def _summarize_memories(self, memories: list[dict[str, Any]]) -> str:
        snippets: list[str] = []
        for item in memories[:2]:
            text = self._normalize_text(str(item.get("text") or ""))
            if text:
                snippets.append(text[:80])
        return "；".join(snippets)

    def _normalize_text(self, text: str) -> str:
        return re.sub(r"\s+", " ", text or "").strip()
