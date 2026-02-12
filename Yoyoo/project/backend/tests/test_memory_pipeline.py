from __future__ import annotations

from app.intelligence.memory import MemoryService
from app.intelligence.memory_pipeline import MemoryPipeline


def test_memory_pipeline_deduplicates_relevant_memories() -> None:
    memory = MemoryService()

    def _fake_retrieve(
        *,
        conversation_id: str,
        user_id: str,
        query: str,
        intent: str,
        limit: int = 5,
    ):
        _ = (conversation_id, user_id, query, intent, limit)
        return [
            {"source": "event", "text": "部署服务成功", "intent": "task_request", "score": 0.91},
            {"source": "task", "text": "部署服务成功", "intent": "task_request", "score": 0.88},
            {
                "source": "summary",
                "text": "需要保留回滚命令",
                "intent": "task_request",
                "score": 0.74,
            },
        ]

    memory.retrieve_relevant_memories = _fake_retrieve  # type: ignore[method-assign]
    pipeline = MemoryPipeline(memory_service=memory)

    pack = pipeline.build_context(
        conversation_id="conv_pipe",
        user_id="u_pipe",
        channel="api",
        query="继续部署服务",
        intent="task_request",
    )

    assert len(pack["relevant_memories"]) == 2
    assert pack["memory_pipeline"]["retrieved_count"] == 3
    assert pack["memory_pipeline"]["deduped_count"] == 2
    assert "部署服务成功" in pack["memory_pipeline"]["summary"]


def test_memory_pipeline_merges_sidecar_memories_when_enabled() -> None:
    memory = MemoryService()

    def _fake_retrieve(
        *,
        conversation_id: str,
        user_id: str,
        query: str,
        intent: str,
        limit: int = 5,
    ):
        _ = (conversation_id, user_id, query, intent, limit)
        return [
            {"source": "event", "text": "部署服务成功", "intent": "task_request", "score": 0.91},
        ]

    class _FakeSidecar:
        enabled = True

        def retrieve(
            self,
            *,
            query: str,
            user_id: str,
            conversation_id: str,
            limit: int = 5,
        ):
            _ = (query, user_id, conversation_id, limit)

            class _Result:
                ok = True
                sufficient = True
                error = None
                items = [
                    {
                        "source": "memu",
                        "text": "回滚命令：git revert <commit>",
                        "intent": "memory",
                        "score": 0.8,
                    }
                ]

            return _Result()

    memory.retrieve_relevant_memories = _fake_retrieve  # type: ignore[method-assign]
    pipeline = MemoryPipeline(memory_service=memory, memory_sidecar=_FakeSidecar())  # type: ignore[arg-type]

    pack = pipeline.build_context(
        conversation_id="conv_pipe_sidecar",
        user_id="u_pipe_sidecar",
        channel="api",
        query="继续部署服务",
        intent="task_request",
    )

    assert len(pack["relevant_memories"]) == 2
    assert pack["memory_pipeline"]["sidecar_used"] is True
    assert pack["memory_pipeline"]["sidecar_ok"] is True
    assert pack["memory_pipeline"]["sidecar_retrieved_count"] == 1
    assert pack["memory_pipeline"]["sufficiency_passed"] is True
