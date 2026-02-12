from __future__ import annotations

from app.intelligence.strategy_cards import StrategyCardSelector


def test_strategy_card_selector_prefers_overlap_and_confidence() -> None:
    selector = StrategyCardSelector()
    cards = [
        {
            "card_id": "card_low",
            "title": "[deploy] 低置信度卡",
            "summary": "部署建议",
            "recommended_steps": ["部署前检查"],
            "trigger_tags": ["deploy"],
            "confidence": 0.55,
        },
        {
            "card_id": "card_high",
            "title": "[deploy] 高置信度卡",
            "summary": "部署并验证",
            "recommended_steps": ["部署后健康检查"],
            "trigger_tags": ["deploy", "task_request"],
            "confidence": 0.86,
        },
        {
            "card_id": "card_other",
            "title": "[frontend] 前端卡",
            "summary": "前端页面优化",
            "recommended_steps": ["优化 UI"],
            "trigger_tags": ["frontend"],
            "confidence": 0.95,
        },
    ]

    selected = selector.select(
        cards=cards,
        query="继续部署后端服务",
        intent="task_request",
        limit=2,
    )

    assert len(selected) == 2
    assert selected[0]["card_id"] == "card_high"
    assert selected[1]["card_id"] == "card_low"
    assert selected[0]["selector_score"] >= selected[1]["selector_score"]

