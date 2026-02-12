from __future__ import annotations

import math
import re
from typing import Any

_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_\u4e00-\u9fff]{2,}")


class StrategyCardSelector:
    """Rank strategy cards by confidence and query/intent relevance."""

    def select(
        self,
        *,
        cards: list[dict[str, Any]],
        query: str,
        intent: str,
        limit: int = 3,
    ) -> list[dict[str, Any]]:
        if not cards:
            return []
        query_tokens = self._tokenize(query)
        query_tokens.add(intent.lower())
        ranked: list[tuple[float, dict[str, Any]]] = []
        for raw in cards:
            card = dict(raw)
            score = self._score(card=card, query_tokens=query_tokens, intent=intent)
            card["selector_score"] = round(score, 4)
            ranked.append((score, card))
        ranked.sort(key=lambda item: item[0], reverse=True)
        return [card for _, card in ranked[: max(1, limit)]]

    def _score(self, *, card: dict[str, Any], query_tokens: set[str], intent: str) -> float:
        confidence = self._safe_float(card.get("confidence"), default=0.4)
        confidence = max(min(confidence, 1.0), 0.0)
        intent_bonus = 0.0
        trigger_tags = {
            str(tag).lower() for tag in card.get("trigger_tags", []) if str(tag).strip()
        }
        trigger_overlap = len(query_tokens & trigger_tags)
        if intent.lower() in trigger_tags:
            intent_bonus += 0.25
        text_blob = " ".join(
            [
                str(card.get("title") or ""),
                str(card.get("summary") or ""),
                " ".join(str(s) for s in card.get("recommended_steps", [])),
            ]
        )
        overlap = self._text_overlap_score(text=text_blob, query_tokens=query_tokens)
        overlap_bonus = overlap * 0.45
        if trigger_overlap <= 0 and overlap <= 0.0:
            confidence *= 0.45
        return confidence + intent_bonus + overlap_bonus

    def _tokenize(self, text: str) -> set[str]:
        tokens = {token.lower() for token in _TOKEN_PATTERN.findall(text or "")}
        expanded: set[str] = set(tokens)
        for token in tokens:
            if self._contains_cjk(token) and len(token) >= 2:
                for idx in range(0, len(token) - 1):
                    expanded.add(token[idx : idx + 2])
        return expanded

    def _text_overlap_score(self, *, text: str, query_tokens: set[str]) -> float:
        if not query_tokens:
            return 0.0
        text_tokens = self._tokenize(text)
        if not text_tokens:
            return 0.0
        overlap = len(query_tokens & text_tokens)
        if overlap <= 0:
            return 0.0
        return overlap / math.sqrt(len(query_tokens) * len(text_tokens))

    def _safe_float(self, value: Any, *, default: float) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def _contains_cjk(self, token: str) -> bool:
        return any("\u4e00" <= ch <= "\u9fff" for ch in token)
