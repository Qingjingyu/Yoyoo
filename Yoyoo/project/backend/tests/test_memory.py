import json
from datetime import UTC, datetime, timedelta

from app.intelligence.memory import MemoryService, StrategyCard


def test_atomic_fact_supersede_instead_of_delete() -> None:
    memory = MemoryService()
    user_id = "user_001"

    memory.upsert_atomic_fact(user_id=user_id, key="preferred_name", value="白澳")
    memory.upsert_atomic_fact(user_id=user_id, key="preferred_name", value="苏白")

    profile = memory.get_or_create_profile(user_id=user_id)
    history = profile.fact_history["preferred_name"]

    assert profile.facts["preferred_name"] == "苏白"
    assert len(history) == 2
    assert history[0]["status"] == "superseded"
    assert history[0]["superseded_by"] == history[1]["id"]
    assert history[1]["status"] == "active"
    assert history[1]["value"] == "苏白"


def test_memory_persists_profiles_and_events(tmp_path) -> None:
    storage_file = tmp_path / "memory.json"
    memory = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)

    memory.upsert_atomic_fact(user_id="user_002", key="preferred_name", value="Yoyoo")
    memory.append_event(
        conversation_id="conv_002",
        user_id="user_002",
        direction="incoming",
        text="你好",
        intent="greeting",
    )

    restored = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)
    profile = restored.get_or_create_profile(user_id="user_002")
    events = restored.recent_events(conversation_id="conv_002", limit=5)

    assert profile.facts["preferred_name"] == "Yoyoo"
    assert len(events) == 1
    assert events[0].text == "你好"


def test_memory_layered_context_and_task_ledger(tmp_path) -> None:
    storage_file = tmp_path / "memory.json"
    memory = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)

    memory.append_event(
        conversation_id="conv_003",
        user_id="user_003",
        direction="incoming",
        text="请帮我部署服务",
        intent="task_request",
        trace_id="trace_003",
    )
    record = memory.create_task_record(
        conversation_id="conv_003",
        user_id="user_003",
        trace_id="trace_003",
        request_text="请帮我部署服务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["1. 准备", "2. 部署"],
        verification_checks=["检查健康状态"],
        rollback_template=["回滚服务"],
    )
    memory.update_task_record(
        task_id=record.task_id,
        status="completed",
        executor_reply="部署完成",
        evidence=["log:ok"],
    )

    restored = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)
    tasks = restored.recent_tasks("conv_003", limit=2)
    context_pack = restored.build_context_pack(conversation_id="conv_003", user_id="user_003")
    trace_events = restored.find_events_by_trace("trace_003")

    assert len(tasks) == 1
    assert tasks[0].status == "completed"
    assert tasks[0].executor_reply == "部署完成"
    assert context_pack["summary_points"]
    assert context_pack["relevant_memories"]
    assert context_pack["recent_tasks"][0]["task_id"] == record.task_id
    assert len(trace_events) == 1


def test_memory_relevance_retrieval_prefers_related_task(tmp_path) -> None:
    storage_file = tmp_path / "memory.json"
    memory = MemoryService(storage_path=str(storage_file), max_events_per_conversation=20)

    memory.append_event(
        conversation_id="conv_relevance",
        user_id="user_relevance",
        direction="incoming",
        text="请帮我部署前端服务",
        intent="task_request",
        trace_id="trace_rel_1",
    )
    related = memory.create_task_record(
        conversation_id="conv_relevance",
        user_id="user_relevance",
        trace_id="trace_rel_1",
        request_text="部署前端服务到生产环境",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["部署"],
        verification_checks=["健康检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=related.task_id,
        status="completed",
        executor_reply="部署成功",
    )

    memory.append_event(
        conversation_id="conv_relevance",
        user_id="user_relevance",
        direction="incoming",
        text="今天聊点别的，比如写周报",
        intent="status",
        trace_id="trace_rel_2",
    )

    memories = memory.retrieve_relevant_memories(
        conversation_id="conv_relevance",
        user_id="user_relevance",
        query="部署服务怎么做",
        intent="task_request",
        limit=3,
    )

    assert memories
    assert "部署" in memories[0]["text"]


def test_memory_learning_hints_generated_from_failures(tmp_path) -> None:
    storage_file = tmp_path / "memory.json"
    memory = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)

    record = memory.create_task_record(
        conversation_id="conv_learning",
        user_id="u_learning",
        trace_id="trace_learning_1",
        request_text="部署后端服务并发布",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["部署后端"],
        verification_checks=["健康检查"],
        rollback_template=["回滚服务"],
    )
    memory.update_task_record(
        task_id=record.task_id,
        status="failed",
        executor_error="local_exec_error: timed out after 30.0 seconds",
    )
    record_2 = memory.create_task_record(
        conversation_id="conv_learning",
        user_id="u_learning",
        trace_id="trace_learning_2",
        request_text="部署后端服务并发布",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["部署后端"],
        verification_checks=["健康检查"],
        rollback_template=["回滚服务"],
    )
    memory.update_task_record(
        task_id=record_2.task_id,
        status="failed",
        executor_error="ssh_exec_error: timeout",
    )

    hints = memory.build_learning_hints(
        user_id="u_learning",
        channel="api",
        project_key="conv_learning",
        query="请部署后端服务",
        intent="task_request",
        limit=3,
    )

    assert hints
    assert any("超时" in item or "失败率" in item for item in hints)


def test_memory_learning_hints_are_scoped_by_user_project_channel(tmp_path) -> None:
    storage_file = tmp_path / "memory.json"
    memory = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)

    r1 = memory.create_task_record(
        conversation_id="conv_a",
        user_id="u_a",
        channel="api",
        project_key="proj_a",
        trace_id="trace_a_1",
        request_text="部署后端服务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["部署"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=r1.task_id,
        status="failed",
        executor_error="local_exec_error: timeout",
    )
    r2 = memory.create_task_record(
        conversation_id="conv_a",
        user_id="u_a",
        channel="api",
        project_key="proj_a",
        trace_id="trace_a_2",
        request_text="部署后端服务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["部署"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=r2.task_id,
        status="failed",
        executor_error="ssh_exec_error: timeout",
    )

    scoped = memory.build_learning_hints(
        user_id="u_a",
        channel="api",
        project_key="proj_a",
        query="继续部署后端服务",
        intent="task_request",
        limit=3,
    )
    other_scope = memory.build_learning_hints(
        user_id="u_b",
        channel="api",
        project_key="proj_b",
        query="继续部署后端服务",
        intent="task_request",
        limit=3,
    )

    assert scoped
    assert any("超时" in item or "失败率" in item for item in scoped)
    assert other_scope == []


def test_memory_builds_strategy_cards_from_learning(tmp_path) -> None:
    storage_file = tmp_path / "memory.json"
    memory = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)

    r1 = memory.create_task_record(
        conversation_id="conv_card",
        user_id="u_card",
        channel="api",
        project_key="proj_card",
        trace_id="trace_card_1",
        request_text="继续部署后端服务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["部署"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=r1.task_id,
        status="failed",
        executor_error="local_exec_error: timeout",
    )
    r2 = memory.create_task_record(
        conversation_id="conv_card",
        user_id="u_card",
        channel="api",
        project_key="proj_card",
        trace_id="trace_card_2",
        request_text="继续部署后端服务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["部署"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=r2.task_id,
        status="failed",
        executor_error="ssh_exec_error: timeout",
    )

    cards = memory.build_strategy_cards(
        user_id="u_card",
        channel="api",
        project_key="proj_card",
        query="继续部署后端服务",
        intent="task_request",
        limit=3,
    )

    assert cards
    assert any("超时恢复策略" in item.title or "先读后写防护" in item.title for item in cards)


def test_memory_applies_human_feedback_to_learning(tmp_path) -> None:
    storage_file = tmp_path / "memory.json"
    memory = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)

    record = memory.create_task_record(
        conversation_id="conv_feedback",
        user_id="u_feedback",
        channel="api",
        project_key="proj_feedback",
        trace_id="trace_feedback_1",
        request_text="部署后端服务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["部署"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=record.task_id,
        status="completed",
        executor_reply="部署完成",
    )

    updated = memory.apply_task_feedback(
        task_id=record.task_id,
        feedback="good",
        note="执行结果可复用",
    )
    assert updated is not None
    assert updated.human_feedback == "good"
    assert isinstance(updated.human_feedback_weight, float)
    assert updated.human_feedback_weight > 0
    assert updated.feedback_note == "执行结果可复用"
    assert updated.feedback_updated_at is not None

    cards = memory.build_strategy_cards(
        user_id="u_feedback",
        channel="api",
        project_key="proj_feedback",
        query="继续部署后端服务",
        intent="task_request",
        limit=3,
    )

    assert cards
    assert any("稳定路径复用" in item.title for item in cards)

    updated_again = memory.apply_task_feedback(
        task_id=record.task_id,
        feedback="good",
        note="再次确认可复用",
    )
    assert updated_again is not None
    assert updated_again.feedback_note == "再次确认可复用"

    updated_bad = memory.apply_task_feedback(
        task_id=record.task_id,
        feedback="bad",
        note="这条路径不稳定",
    )
    assert updated_bad is not None
    assert updated_bad.human_feedback == "bad"

    cards_after_bad = memory.build_strategy_cards(
        user_id="u_feedback",
        channel="api",
        project_key="proj_feedback",
        query="继续部署后端服务",
        intent="task_request",
        limit=3,
    )
    assert cards_after_bad
    assert all("稳定路径复用" not in item.title for item in cards_after_bad)
    assert any(
        "先读后写防护" in item.title or "超时恢复策略" in item.title
        for item in cards_after_bad
    )


def test_memory_recovers_from_backup_when_primary_corrupted(tmp_path) -> None:
    storage_file = tmp_path / "memory.json"
    memory = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)
    memory.append_event(
        conversation_id="conv_recover",
        user_id="u_recover",
        direction="incoming",
        text="第一次写入",
        intent="task_request",
    )
    memory.append_event(
        conversation_id="conv_recover",
        user_id="u_recover",
        direction="incoming",
        text="第二次写入",
        intent="task_request",
    )

    storage_file.write_text("{ bad json", encoding="utf-8")
    restored = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)

    events = restored.recent_events("conv_recover", limit=5)
    diagnostics = restored.persistence_diagnostics()

    assert events
    assert any("写入" in item.text for item in events)
    assert diagnostics["last_load_source"].startswith("backup_")
    assert diagnostics["recovery_count"] == 1
    payload = json.loads(storage_file.read_text(encoding="utf-8"))
    assert "events" in payload


def test_memory_ops_health_snapshot_contains_persistence(tmp_path) -> None:
    storage_file = tmp_path / "memory.json"
    memory = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)
    record = memory.create_task_record(
        conversation_id="conv_ops",
        user_id="u_ops",
        trace_id="trace_ops_1",
        request_text="执行任务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["1. 执行"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(task_id=record.task_id, status="completed", executor_reply="ok")

    snapshot = memory.ops_health_snapshot()

    assert snapshot["task_total"] == 1
    assert snapshot["task_completed"] == 1
    assert snapshot["feedback_pending"] == 1
    assert snapshot["persistence"]["enabled"] is True
    assert snapshot["persistence"]["storage_path"] == str(storage_file)
    assert "feedback_binding" in snapshot
    assert "memory_quality" in snapshot
    assert "strategy_card_total" in snapshot["memory_quality"]
    assert "strategy_avg_performance_score" in snapshot["memory_quality"]


def test_memory_persists_structured_evidence_and_duration(tmp_path) -> None:
    storage_file = tmp_path / "memory.json"
    memory = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)
    record = memory.create_task_record(
        conversation_id="conv_evidence",
        user_id="u_evidence",
        trace_id="trace_evidence_1",
        request_text="执行任务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["1. 执行"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=record.task_id,
        status="completed",
        executor_reply="ok",
        evidence=["trace:trace_evidence_1"],
        evidence_structured=[
            {"type": "route_model", "value": "openai/gpt-5.2-codex"},
            {"type": "execution_duration_ms", "value": 1234},
        ],
        execution_duration_ms=1234,
    )
    restored = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)
    loaded = restored.get_task_record(task_id=record.task_id)

    assert loaded is not None
    assert loaded.execution_duration_ms == 1234
    assert loaded.evidence_structured
    assert loaded.evidence_structured[0]["type"] == "route_model"


def test_memory_external_message_task_mapping(tmp_path) -> None:
    storage_file = tmp_path / "memory.json"
    memory = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)
    record = memory.create_task_record(
        conversation_id="conv_map_memory",
        user_id="u_map_memory",
        channel="dingtalk",
        project_key="proj_map_memory",
        trace_id="trace_map_memory",
        request_text="执行任务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["1. 执行"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.bind_external_message_task(
        platform="dingtalk",
        conversation_id="conv_map_memory",
        message_id="msg_001",
        task_id=record.task_id,
    )
    resolved = memory.resolve_external_message_task(
        platform="dingtalk",
        conversation_id="conv_map_memory",
        message_id="msg_001",
    )

    assert resolved == record.task_id


def test_memory_feedback_binding_metrics_recorded(tmp_path) -> None:
    storage_file = tmp_path / "memory.json"
    memory = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)

    memory.record_feedback_binding_attempt(source="conversation_user_recent", success=True)
    memory.record_feedback_binding_attempt(source="user_channel_recent_short_retry", success=True)
    memory.record_feedback_binding_attempt(source="not_found", success=False)
    snapshot = memory.ops_health_snapshot()["feedback_binding"]

    assert snapshot["attempt_total"] == 3
    assert snapshot["success_total"] == 2
    assert snapshot["not_found_total"] == 1
    assert snapshot["short_retry_total"] == 1


def test_memory_strategy_runtime_metrics_feedback_and_persistence(tmp_path) -> None:
    storage_file = tmp_path / "memory.json"
    memory = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)

    seed_1 = memory.create_task_record(
        conversation_id="conv_strategy_rt",
        user_id="u_strategy_rt",
        channel="api",
        project_key="proj_strategy_rt",
        trace_id="trace_strategy_rt_1",
        request_text="继续部署后端服务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["部署"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=seed_1.task_id,
        status="failed",
        executor_error="timeout while executing",
    )
    seed_2 = memory.create_task_record(
        conversation_id="conv_strategy_rt",
        user_id="u_strategy_rt",
        channel="api",
        project_key="proj_strategy_rt",
        trace_id="trace_strategy_rt_2",
        request_text="继续部署后端服务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["部署"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=seed_2.task_id,
        status="failed",
        executor_error="timeout while executing",
    )
    cards = memory.build_strategy_cards(
        user_id="u_strategy_rt",
        channel="api",
        project_key="proj_strategy_rt",
        query="继续部署后端服务",
        intent="task_request",
        limit=1,
    )
    assert cards
    selected_card_id = cards[0].card_id

    run_task = memory.create_task_record(
        conversation_id="conv_strategy_rt",
        user_id="u_strategy_rt",
        channel="api",
        project_key="proj_strategy_rt",
        trace_id="trace_strategy_rt_3",
        request_text="继续部署后端服务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["部署"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=run_task.task_id,
        status="completed",
        executor_reply="ok",
        strategy_cards_used=[selected_card_id],
    )
    memory.update_task_record(
        task_id=run_task.task_id,
        status="completed",
        executor_reply="ok-again",
        strategy_cards_used=[selected_card_id],
    )

    before_feedback = memory.build_context_pack(
        conversation_id="conv_strategy_rt",
        user_id="u_strategy_rt",
        channel="api",
        project_key="proj_strategy_rt",
        query="继续部署后端服务",
        intent="task_request",
    )
    matched_before = [
        item
        for item in before_feedback["strategy_cards"]
        if item["card_id"] == selected_card_id
    ]
    assert matched_before
    before = matched_before[0]
    assert before["runtime_metrics"]["success_total"] == 1.0
    assert before["runtime_metrics"]["signal_total"] >= 1.0

    memory.apply_task_feedback(task_id=run_task.task_id, feedback="bad", note="这条路径不稳")
    after_feedback = memory.build_context_pack(
        conversation_id="conv_strategy_rt",
        user_id="u_strategy_rt",
        channel="api",
        project_key="proj_strategy_rt",
        query="继续部署后端服务",
        intent="task_request",
    )
    matched_after = [
        item
        for item in after_feedback["strategy_cards"]
        if item["card_id"] == selected_card_id
    ]
    assert matched_after
    after = matched_after[0]
    assert after["runtime_metrics"]["feedback_bad"] > 0.0
    assert after["performance_score"] <= before["performance_score"]

    restored = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)
    restored_context = restored.build_context_pack(
        conversation_id="conv_strategy_rt",
        user_id="u_strategy_rt",
        channel="api",
        project_key="proj_strategy_rt",
        query="继续部署后端服务",
        intent="task_request",
    )
    restored_match = [
        item
        for item in restored_context["strategy_cards"]
        if item["card_id"] == selected_card_id
    ]
    assert restored_match
    assert restored_match[0]["runtime_metrics"]["feedback_bad"] > 0.0


def test_memory_strategy_decay_prefers_recent_cards(tmp_path) -> None:
    storage_file = tmp_path / "memory.json"
    memory = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)
    scope = "u_decay|api|proj_decay"
    now = datetime.now(UTC)
    old_card = StrategyCard(
        card_id="card_decay_old",
        scope=scope,
        tag="deploy",
        title="[deploy] old",
        summary="old strategy",
        trigger_tags=["deploy", "task_request"],
        recommended_steps=["old step"],
        cautions=["old caution"],
        evidence_requirements=["old evidence"],
        confidence=0.9,
        source="learning_loop_v2",
        created_at=now - timedelta(days=45),
        updated_at=now - timedelta(days=45),
    )
    new_card = StrategyCard(
        card_id="card_decay_new",
        scope=scope,
        tag="deploy",
        title="[deploy] new",
        summary="new strategy",
        trigger_tags=["deploy", "task_request"],
        recommended_steps=["new step"],
        cautions=["new caution"],
        evidence_requirements=["new evidence"],
        confidence=0.9,
        source="learning_loop_v2",
        created_at=now - timedelta(days=1),
        updated_at=now - timedelta(hours=2),
    )
    memory._strategy_cards[old_card.card_id] = old_card
    memory._strategy_cards[new_card.card_id] = new_card
    memory._scope_strategy_cards[scope].append(old_card.card_id)
    memory._scope_strategy_cards[scope].append(new_card.card_id)

    cards = memory.build_strategy_cards(
        user_id="u_decay",
        channel="api",
        project_key="proj_decay",
        query="继续部署后端服务",
        intent="task_request",
        limit=2,
    )

    assert len(cards) == 2
    assert cards[0].card_id == "card_decay_new"


def test_memory_daily_execution_snapshot_metrics(tmp_path) -> None:
    storage_file = tmp_path / "memory.json"
    memory = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)

    ok_task = memory.create_task_record(
        conversation_id="conv_daily",
        user_id="u_daily",
        channel="api",
        project_key="proj_daily",
        trace_id="trace_daily_1",
        request_text="部署服务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["部署"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=ok_task.task_id,
        status="completed",
        executor_reply="ok",
        strategy_cards_used=["card_x"],
    )
    fail_task = memory.create_task_record(
        conversation_id="conv_daily",
        user_id="u_daily",
        channel="api",
        project_key="proj_daily",
        trace_id="trace_daily_2",
        request_text="部署服务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["部署"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=fail_task.task_id,
        status="failed",
        executor_error="timeout",
    )
    memory.record_feedback_binding_attempt(source="conversation_user_recent", success=True)
    memory.record_feedback_binding_attempt(source="not_found", success=False)

    snapshot = memory.daily_execution_snapshot(window_hours=24.0)

    assert snapshot["task_total"] == 2
    assert snapshot["task_terminal_total"] == 2
    assert snapshot["task_success_total"] == 1
    assert snapshot["task_failed_total"] == 1
    assert snapshot["task_success_rate"] == 0.5
    assert snapshot["strategy_hit_total"] == 1
    assert snapshot["strategy_hit_rate"] == 0.5
    assert snapshot["feedback_binding_attempt_total"] == 2
    assert snapshot["feedback_binding_success_total"] == 1
    assert snapshot["feedback_binding_success_rate"] == 0.5


def test_memory_feedback_conflict_rate_uses_feedback_history(tmp_path) -> None:
    storage_file = tmp_path / "memory.json"
    memory = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)
    task = memory.create_task_record(
        conversation_id="conv_feedback_conflict",
        user_id="u_feedback_conflict",
        channel="dingtalk",
        project_key="proj_feedback_conflict",
        trace_id="trace_feedback_conflict",
        request_text="执行部署任务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["部署"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(task_id=task.task_id, status="completed", executor_reply="ok")

    memory.apply_task_feedback(task_id=task.task_id, feedback="good", note="这次很好")
    memory.apply_task_feedback(task_id=task.task_id, feedback="bad", note="改一下，这次不好")

    snapshot = memory.ops_health_snapshot()
    feedback_binding = snapshot["feedback_binding"]
    memory_quality = snapshot["memory_quality"]

    assert feedback_binding["override_total"] == 1
    assert memory_quality["feedback_task_total"] == 1
    assert memory_quality["feedback_conflict_total"] == 1
    assert memory_quality["feedback_conflict_rate"] == 1.0


def test_memory_strategy_cards_fallback_when_no_overlap(tmp_path) -> None:
    storage_file = tmp_path / "memory.json"
    memory = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)
    now = datetime.now(UTC)
    scoped_card = StrategyCard(
        card_id="card_fallback_scoped",
        scope="u_fallback|api|general",
        tag="browser",
        title="[browser] fallback",
        summary="用于兜底的策略",
        trigger_tags=["browser"],
        recommended_steps=["先读后写"],
        cautions=["避免直接破坏性操作"],
        evidence_requirements=["保留执行日志"],
        confidence=0.45,
        source="test_seed",
        created_at=now,
        updated_at=now,
    )
    memory._strategy_cards[scoped_card.card_id] = scoped_card
    memory._scope_strategy_cards[scoped_card.scope].append(scoped_card.card_id)

    cards = memory.build_strategy_cards(
        user_id="u_fallback",
        channel="api",
        project_key="proj_fallback",
        query="请继续部署后端服务",
        intent="task_request",
        limit=1,
    )

    assert len(cards) == 1
    assert cards[0].card_id == "card_fallback_scoped"


def test_memory_strategy_cards_include_global_scope_fallback(tmp_path) -> None:
    storage_file = tmp_path / "memory.json"
    memory = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)
    now = datetime.now(UTC)
    global_card = StrategyCard(
        card_id="card_global_default",
        scope="global|global|general",
        tag="general",
        title="[global] default",
        summary="全局默认策略卡",
        trigger_tags=["task_request"],
        recommended_steps=["先读后写"],
        cautions=["避免直接破坏性操作"],
        evidence_requirements=["保留执行日志"],
        confidence=0.71,
        source="test_seed",
        created_at=now,
        updated_at=now,
    )
    memory._strategy_cards[global_card.card_id] = global_card
    memory._scope_strategy_cards[global_card.scope].append(global_card.card_id)

    cards = memory.build_strategy_cards(
        user_id="u_no_cards",
        channel="api",
        project_key="proj_no_cards",
        query="请继续这个任务",
        intent="task_request",
        limit=1,
    )

    assert len(cards) == 1
    assert cards[0].card_id == "card_global_default"


def test_memory_strategy_cards_use_builtin_default_when_empty(tmp_path) -> None:
    storage_file = tmp_path / "memory.json"
    memory = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)

    cards = memory.build_strategy_cards(
        user_id="u_builtin",
        channel="api",
        project_key="proj_builtin",
        query="请部署服务",
        intent="task_request",
        limit=1,
    )

    assert len(cards) == 1
    assert cards[0].card_id == "card_builtin_task_request_v1"
    assert cards[0].source == "builtin_strategy_v1"


def test_memory_rebalance_strategy_cards_reorders_and_demotes(tmp_path) -> None:
    storage_file = tmp_path / "memory.json"
    memory = MemoryService(storage_path=str(storage_file), max_events_per_conversation=10)
    scope = "u_rebalance|api|proj_rebalance"
    now = datetime.now(UTC)
    low_card = StrategyCard(
        card_id="card_rebalance_low",
        scope=scope,
        tag="deploy",
        title="[deploy] low",
        summary="low card",
        trigger_tags=["deploy", "task_request"],
        recommended_steps=["low step"],
        cautions=["low caution"],
        evidence_requirements=["low evidence"],
        confidence=0.85,
        source="learning_loop_v2",
        created_at=now - timedelta(days=5),
        updated_at=now - timedelta(days=5),
    )
    high_card = StrategyCard(
        card_id="card_rebalance_high",
        scope=scope,
        tag="deploy",
        title="[deploy] high",
        summary="high card",
        trigger_tags=["deploy", "task_request"],
        recommended_steps=["high step"],
        cautions=["high caution"],
        evidence_requirements=["high evidence"],
        confidence=0.70,
        source="learning_loop_v2",
        created_at=now - timedelta(days=1),
        updated_at=now - timedelta(hours=1),
    )
    memory._strategy_cards[low_card.card_id] = low_card
    memory._strategy_cards[high_card.card_id] = high_card
    memory._scope_strategy_cards[scope].append(low_card.card_id)
    memory._scope_strategy_cards[scope].append(high_card.card_id)
    memory._strategy_card_runtime_metrics[low_card.card_id] = {
        "success_total": 0.0,
        "failed_total": 3.0,
        "timeout_total": 2.0,
        "feedback_good": 0.0,
        "feedback_bad": 2.0,
        "last_task_id": "task_low",
        "last_updated": now.isoformat(),
    }
    memory._strategy_card_runtime_metrics[high_card.card_id] = {
        "success_total": 4.0,
        "failed_total": 0.0,
        "timeout_total": 0.0,
        "feedback_good": 1.0,
        "feedback_bad": 0.0,
        "last_task_id": "task_high",
        "last_updated": now.isoformat(),
    }

    result = memory.rebalance_strategy_cards()

    assert result["changed"] is True
    assert result["scopes_reordered"] >= 1
    ordered = list(memory._scope_strategy_cards[scope])
    assert ordered[0] == "card_rebalance_high"
    assert memory._strategy_cards["card_rebalance_low"].confidence < 0.85
