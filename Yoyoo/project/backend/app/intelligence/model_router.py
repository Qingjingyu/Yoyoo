from __future__ import annotations


class ModelRouter:
    """Route intents to preferred model profile names."""

    def choose(self, *, intent: str, text: str) -> str:
        normalized = text.lower()
        if intent in {"task_request", "status"} and any(
            token in normalized
            for token in ("代码", "code", "bug", "修复", "测试", "deploy", "开发", "部署")
        ):
            return "openai/gpt-5.2-codex"
        if intent in {"task_request", "chat"} and any(
            token in normalized for token in ("策略", "架构", "方案", "roadmap", "design")
        ):
            return "anthropic/claude-opus-4-5"
        return "minimax/MiniMax-M2.1"
