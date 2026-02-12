from app.intelligence.planner import TaskPlanner
from app.intelligence.research_playbook import ResearchPlaybook


def test_planner_applies_learning_hints_as_templates() -> None:
    planner = TaskPlanner(playbook=ResearchPlaybook())
    steps, _ = planner.build_plan("帮我部署服务")
    enhanced = planner.apply_learning_hints(
        steps=steps,
        learning_hints=[
            "[deploy] 最近有超时，先做健康检查并拆小任务，再执行变更。",
            "[deploy] 近期成功率较高，可优先复用上一条稳定执行路径。",
        ],
    )

    assert enhanced
    assert enhanced[0].startswith("1. 先做执行器健康检查")
    assert any("优先复用最近一次稳定参数与路径" in item for item in enhanced)


def test_planner_without_learning_hints_keeps_original_steps() -> None:
    planner = TaskPlanner(playbook=ResearchPlaybook())
    steps, _ = planner.build_plan("帮我部署服务")

    enhanced = planner.apply_learning_hints(steps=steps, learning_hints=[])

    assert enhanced == steps


def test_planner_applies_strategy_cards_and_read_only_guard() -> None:
    planner = TaskPlanner(playbook=ResearchPlaybook())
    steps, _ = planner.build_plan("部署生产服务")

    enhanced = planner.apply_strategy_cards(
        steps=steps,
        strategy_cards=[
            {
                "recommended_steps": ["先做执行器健康检查（版本/进程/通道）。"],
                "cautions": ["未完成只读探测前不要执行破坏性写操作。"],
                "evidence_requirements": ["保留命令输出", "记录健康检查结果"],
            }
        ],
        enforce_read_only_first=True,
    )

    assert enhanced
    assert enhanced[0].startswith("1. 先执行只读探测")
    assert any("注意事项：" in item for item in enhanced)
    assert any("收集证据：" in item for item in enhanced)


def test_planner_should_enforce_read_only_first_for_risky_task() -> None:
    planner = TaskPlanner(playbook=ResearchPlaybook())

    assert planner.should_enforce_read_only_first("请在生产数据库执行迁移") is True
    assert planner.should_enforce_read_only_first("整理前端样式") is False
