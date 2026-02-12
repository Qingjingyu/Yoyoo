import pytest
from pydantic import ValidationError

from app.intelligence.team_models import RoleProfile, TaskCard, TaskEvidence


def test_team_models_can_be_constructed() -> None:
    role = RoleProfile(role_id="ENG", display_name="开发负责人", duties=["开发", "修复"])
    evidence = TaskEvidence(source="log", content="pytest all passed")
    card = TaskCard(
        task_id="task_20260210112233_abcd1234",
        title="修复接口",
        objective="修复 team api 的 500 问题",
        owner_role=role.role_id,
        status="running",
        evidence=[evidence],
    )

    assert role.role_id == "ENG"
    assert card.status == "running"
    assert card.evidence[0].source == "log"


def test_task_card_rejects_invalid_status() -> None:
    with pytest.raises(ValidationError):
        TaskCard(
            task_id="task_20260210112233_abcd1234",
            title="无效状态任务",
            objective="测试非法状态",
            owner_role="ENG",
            status="blocked",
        )
