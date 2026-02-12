from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
from dataclasses import dataclass
from time import monotonic
from typing import Any

_TASK_ID_PATTERN = re.compile(r"\btask_\d{14}_[a-z0-9]{8}\b", re.IGNORECASE)


@dataclass
class DingtalkIncomingMessage:
    event_id: str
    sender_user_id: str
    conversation_id: str
    text: str
    scope: str
    is_mentioned: bool
    session_webhook: str | None
    task_id_hint: str | None = None
    quoted_message_id: str | None = None


class DingtalkEventService:
    """
    Parse DingTalk events into a normalized internal message.
    Signature verification is optional and controlled by `secret`.
    """

    def __init__(
        self,
        secret: str | None = None,
        ingress_dedupe_window_sec: float = 120.0,
    ) -> None:
        self.secret = secret
        self._ingress_dedupe_window_sec = max(float(ingress_dedupe_window_sec), 1.0)
        self._recent_ingress: dict[str, float] = {}

    def register_ingress(self, incoming: DingtalkIncomingMessage) -> tuple[bool, str]:
        now = monotonic()
        self._prune_ingress(now=now)
        ingress_key = self._build_ingress_key(incoming=incoming)
        seen_at = self._recent_ingress.get(ingress_key)
        if seen_at is not None and (now - seen_at) <= self._ingress_dedupe_window_sec:
            return False, ingress_key
        self._recent_ingress[ingress_key] = now
        return True, ingress_key

    def is_url_verification(self, payload: dict[str, Any]) -> bool:
        return "challenge" in payload

    def build_expected_signature(
        self,
        *,
        raw_body: bytes,
        timestamp: str,
        nonce: str,
    ) -> str:
        if not self.secret:
            return ""
        data = f"{timestamp}\n{nonce}\n".encode() + raw_body
        digest = hmac.new(self.secret.encode("utf-8"), data, hashlib.sha256).digest()
        return base64.b64encode(digest).decode("utf-8")

    def verify_signature(
        self,
        *,
        raw_body: bytes,
        timestamp: str | None,
        nonce: str | None,
        signature: str | None,
    ) -> bool:
        if not self.secret:
            return True
        if not timestamp or not nonce or not signature:
            return False
        expected = self.build_expected_signature(
            raw_body=raw_body,
            timestamp=timestamp,
            nonce=nonce,
        )
        return hmac.compare_digest(signature, expected)

    def parse_message(self, payload: dict[str, Any]) -> DingtalkIncomingMessage | None:
        text = self._extract_message_text(payload)
        if not text:
            return None

        event_id = str(payload.get("eventId") or payload.get("msgId") or "")
        sender_user_id = str(
            payload.get("senderStaffId")
            or payload.get("senderId")
            or payload.get("from")
            or payload.get("chatbotUserId")
            or ""
        )
        conversation_id = str(
            payload.get("conversationId")
            or payload.get("chatId")
            or payload.get("openConversationId")
            or payload.get("chatbotConversationId")
            or ""
        )
        session_webhook = str(payload.get("sessionWebhook") or "").strip() or None
        if not conversation_id and session_webhook:
            digest = hashlib.sha1(session_webhook.encode("utf-8")).hexdigest()[:16]
            conversation_id = f"session:{digest}"
        conversation_type = str(payload.get("conversationType") or payload.get("chatType") or "")
        scope = "group" if conversation_type == "2" else "private"
        at_users = payload.get("atUsers")
        is_mentioned = bool(payload.get("isInAtList"))
        if isinstance(at_users, list) and at_users:
            is_mentioned = True

        if not sender_user_id or not conversation_id:
            return None

        if not event_id:
            payload_digest = hashlib.sha1(
                json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
            ).hexdigest()[:12]
            event_id = f"{sender_user_id}:{conversation_id}:{payload_digest}"

        task_id_hint = self._extract_task_id_hint(payload=payload, text=text)
        quoted_message_id = self._extract_quoted_message_id(payload=payload)
        return DingtalkIncomingMessage(
            event_id=event_id,
            sender_user_id=sender_user_id,
            conversation_id=conversation_id,
            text=text,
            scope=scope,
            is_mentioned=is_mentioned,
            session_webhook=session_webhook,
            task_id_hint=task_id_hint,
            quoted_message_id=quoted_message_id,
        )

    def _extract_message_text(self, payload: dict[str, Any]) -> str:
        text_block = payload.get("text") or {}
        if isinstance(text_block, dict):
            for key in ("content", "text", "title"):
                value = str(text_block.get(key, "")).strip()
                if value:
                    return value
        elif isinstance(text_block, str):
            value = text_block.strip()
            if value:
                return value

        content = payload.get("content")
        if isinstance(content, (dict, list)):
            value = self._flatten_text(content)
            if value:
                return value
        elif isinstance(content, str):
            value = content.strip()
            if value:
                parsed = self._try_parse_json(value)
                if parsed is not None:
                    flattened = self._flatten_text(parsed)
                    if flattened:
                        return flattened
                return value

        return ""

    def _try_parse_json(self, raw_text: str) -> Any | None:
        try:
            return json.loads(raw_text)
        except Exception:
            return None

    def _flatten_text(self, value: Any) -> str:
        parts: list[str] = []
        self._collect_text_parts(value=value, sink=parts)
        merged = " ".join(part for part in parts if part).strip()
        return re.sub(r"\s+", " ", merged).strip()

    def _collect_text_parts(self, *, value: Any, sink: list[str]) -> None:
        if isinstance(value, str):
            text = value.strip()
            if text:
                sink.append(text)
            return
        if isinstance(value, list):
            for item in value:
                self._collect_text_parts(value=item, sink=sink)
            return
        if isinstance(value, dict):
            preferred_keys = (
                "text",
                "content",
                "title",
                "question",
                "value",
                "label",
                "prompt",
            )
            for key in preferred_keys:
                if key in value:
                    self._collect_text_parts(value=value.get(key), sink=sink)
            for key, item in value.items():
                if key in preferred_keys:
                    continue
                self._collect_text_parts(value=item, sink=sink)

    def _extract_task_id_hint(self, *, payload: dict[str, Any], text: str) -> str | None:
        direct = self._find_task_id(text)
        if direct:
            return direct

        # Prefer common reply/quote containers from DingTalk-like payloads.
        for key in (
            "replyMessage",
            "reply",
            "quote",
            "quoteText",
            "quotedMessage",
            "repliedMessage",
            "referenceMessage",
            "originMessage",
            "originalMessage",
        ):
            hinted = self._find_task_id_in_value(payload.get(key))
            if hinted:
                return hinted

        # Fallback: scan nested fields that are likely related to message references.
        hinted = self._find_task_id_in_reference_fields(payload)
        if hinted:
            return hinted
        return None

    def _find_task_id_in_reference_fields(self, value: Any, *, path: str = "") -> str | None:
        if isinstance(value, str):
            if any(token in path for token in ("reply", "quote", "refer", "origin", "original")):
                return self._find_task_id(value)
            return None
        if isinstance(value, dict):
            for key, item in value.items():
                next_path = f"{path}.{str(key).lower()}" if path else str(key).lower()
                hinted = self._find_task_id_in_reference_fields(item, path=next_path)
                if hinted:
                    return hinted
            return None
        if isinstance(value, list):
            for item in value:
                hinted = self._find_task_id_in_reference_fields(item, path=path)
                if hinted:
                    return hinted
            return None
        return None

    def _find_task_id_in_value(self, value: Any) -> str | None:
        if isinstance(value, str):
            return self._find_task_id(value)
        if isinstance(value, dict):
            for item in value.values():
                hinted = self._find_task_id_in_value(item)
                if hinted:
                    return hinted
            return None
        if isinstance(value, list):
            for item in value:
                hinted = self._find_task_id_in_value(item)
                if hinted:
                    return hinted
            return None
        return None

    def _find_task_id(self, text: str) -> str | None:
        match = _TASK_ID_PATTERN.search(text or "")
        if match is None:
            return None
        return match.group(0).lower()

    def _extract_quoted_message_id(self, *, payload: dict[str, Any]) -> str | None:
        for key in (
            "replyMessage",
            "reply",
            "quote",
            "quotedMessage",
            "repliedMessage",
            "referenceMessage",
            "originMessage",
            "originalMessage",
        ):
            message_id = self._find_message_id_in_value(payload.get(key))
            if message_id:
                return message_id
        return self._find_message_id_in_reference_fields(payload)

    def _find_message_id_in_reference_fields(self, value: Any, *, path: str = "") -> str | None:
        if isinstance(value, dict):
            for key, item in value.items():
                key_normalized = str(key).lower()
                next_path = f"{path}.{key_normalized}" if path else key_normalized
                in_reference_path = any(
                    token in next_path
                    for token in ("reply", "quote", "refer", "origin", "original")
                )
                if (
                    key_normalized in {"messageid", "msgid", "message_id", "msg_id"}
                    and in_reference_path
                ):
                    message_id = str(item).strip()
                    if message_id:
                        return message_id
                if in_reference_path:
                    nested = self._find_message_id_in_value(item)
                    if nested:
                        return nested
                hinted = self._find_message_id_in_reference_fields(item, path=next_path)
                if hinted:
                    return hinted
            return None
        if isinstance(value, list):
            for item in value:
                hinted = self._find_message_id_in_reference_fields(item, path=path)
                if hinted:
                    return hinted
            return None
        return None

    def _find_message_id_in_value(self, value: Any) -> str | None:
        if isinstance(value, dict):
            for key, item in value.items():
                key_normalized = str(key).lower()
                if key_normalized in {"messageid", "msgid", "message_id", "msg_id"}:
                    message_id = str(item).strip()
                    if message_id:
                        return message_id
            for item in value.values():
                hinted = self._find_message_id_in_value(item)
                if hinted:
                    return hinted
            return None
        if isinstance(value, list):
            for item in value:
                hinted = self._find_message_id_in_value(item)
                if hinted:
                    return hinted
            return None
        return None

    def _build_ingress_key(self, *, incoming: DingtalkIncomingMessage) -> str:
        text_digest = hashlib.sha1(incoming.text.encode("utf-8")).hexdigest()[:12]
        return (
            "dingtalk:"
            f"{incoming.conversation_id}:"
            f"{incoming.sender_user_id}:"
            f"{incoming.event_id}:"
            f"{text_digest}"
        )

    def _prune_ingress(self, *, now: float) -> None:
        expired_before = now - self._ingress_dedupe_window_sec
        stale_keys = [
            key
            for key, seen_at in self._recent_ingress.items()
            if seen_at < expired_before
        ]
        for key in stale_keys:
            self._recent_ingress.pop(key, None)
