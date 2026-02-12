from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from time import time
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)


@dataclass
class OutboundMessage:
    platform: str
    conversation_id: str
    text: str
    session_webhook: str | None = None
    trace_id: str | None = None
    delivered: bool = False
    error: str | None = None


class DingtalkClient:
    """
    DingTalk outbound client.
    Always stores outbound attempts in-memory and optionally sends to sessionWebhook.
    """

    _TOKEN_URL = "https://api.dingtalk.com/v1.0/oauth2/accessToken"
    _GROUP_SEND_URL = "https://api.dingtalk.com/v1.0/robot/groupMessages/send"
    _OTO_SEND_URL = "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend"

    def __init__(
        self,
        *,
        client_id: str | None = None,
        client_secret: str | None = None,
        robot_code: str | None = None,
        timeout_sec: float = 8.0,
    ) -> None:
        self.sent_messages: list[OutboundMessage] = []
        self._client_id = client_id
        self._client_secret = client_secret
        self._robot_code = robot_code
        self._timeout_sec = timeout_sec
        self._access_token: str | None = None
        self._access_token_expire_at: float = 0.0

    def send_text(
        self,
        *,
        conversation_id: str,
        text: str,
        session_webhook: str | None = None,
        trace_id: str | None = None,
    ) -> OutboundMessage:
        normalized_text = self._normalize_text(text)
        message = OutboundMessage(
            platform="dingtalk",
            conversation_id=conversation_id,
            text=normalized_text,
            session_webhook=session_webhook,
            trace_id=trace_id,
        )
        if session_webhook:
            error = self._send_via_session_webhook(
                session_webhook=session_webhook,
                text=normalized_text,
            )
        else:
            error = self._send_proactive_text(
                conversation_id=conversation_id,
                text=normalized_text,
            )
        if error is None:
            message.delivered = True
        else:
            message.error = error
        logger.info(
            "dingtalk_outbound trace_id=%s conversation_id=%s delivered=%s error=%s",
            trace_id,
            conversation_id,
            message.delivered,
            message.error,
        )
        self.sent_messages.append(message)
        return message

    def _normalize_text(self, text: str) -> str:
        stripped = text.strip()
        if len(stripped) <= 4000:
            return stripped
        return stripped[:3997] + "..."

    def _send_via_session_webhook(self, *, session_webhook: str, text: str) -> str | None:
        headers = {"Content-Type": "application/json"}
        token_error, token = self._get_access_token()
        if token_error is not None:
            return token_error
        if token:
            headers["x-acs-dingtalk-access-token"] = token
        payload = {"msgtype": "text", "text": {"content": text}}
        request = Request(
            session_webhook,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urlopen(request, timeout=self._timeout_sec) as response:
                status = response.getcode()
                raw_body = response.read().decode("utf-8", errors="replace")
        except (URLError, TimeoutError, OSError) as exc:
            return f"webhook_send_error:{exc}"

        if status >= 400:
            return f"webhook_http_status:{status}"

        if raw_body:
            try:
                body: Any = json.loads(raw_body)
            except json.JSONDecodeError:
                return None
            if isinstance(body, dict):
                if body.get("success") is False:
                    return "webhook_business_error:success_false"
                errcode = body.get("errcode")
                if isinstance(errcode, int) and errcode != 0:
                    return f"webhook_business_error:errcode_{errcode}"
        return None

    def _send_proactive_text(self, *, conversation_id: str, text: str) -> str | None:
        token_error, token = self._get_access_token()
        if token_error is not None:
            return token_error
        if not token:
            return "token_fetch_missing_access_token"

        robot_code = (self._robot_code or self._client_id or "").strip()
        if not robot_code:
            return "proactive_send_missing_robot_code"

        is_group = conversation_id.startswith("cid")
        payload: dict[str, Any] = {
            "robotCode": robot_code,
            "msgKey": "sampleText",
            "msgParam": json.dumps({"content": text}, ensure_ascii=False),
        }
        if is_group:
            payload["openConversationId"] = conversation_id
            url = self._GROUP_SEND_URL
        else:
            payload["userIds"] = [conversation_id]
            url = self._OTO_SEND_URL

        request = Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "x-acs-dingtalk-access-token": token,
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=self._timeout_sec) as response:
                status = response.getcode()
                raw_body = response.read().decode("utf-8", errors="replace")
        except (URLError, TimeoutError, OSError) as exc:
            return f"proactive_send_error:{exc}"

        if status >= 400:
            return f"proactive_http_status:{status}"
        if not raw_body:
            return None
        try:
            body: Any = json.loads(raw_body)
        except json.JSONDecodeError:
            return None
        if isinstance(body, dict):
            errcode = body.get("errcode")
            if isinstance(errcode, int) and errcode != 0:
                return f"proactive_business_error:errcode_{errcode}"
            success = body.get("success")
            if success is False:
                return "proactive_business_error:success_false"
        return None

    def _get_access_token(self) -> tuple[str | None, str | None]:
        if not self._client_id or not self._client_secret:
            return None, None
        now = time()
        if self._access_token and self._access_token_expire_at - now > 60:
            return None, self._access_token

        request = Request(
            self._TOKEN_URL,
            data=json.dumps(
                {
                    "appKey": self._client_id,
                    "appSecret": self._client_secret,
                }
            ).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=self._timeout_sec) as response:
                status = response.getcode()
                raw_body = response.read().decode("utf-8")
        except (URLError, TimeoutError, OSError) as exc:
            return f"token_fetch_error:{exc}", None
        if status >= 400:
            return f"token_fetch_http_status:{status}", None
        try:
            body = json.loads(raw_body)
        except json.JSONDecodeError:
            return "token_fetch_invalid_json", None
        if not isinstance(body, dict):
            return "token_fetch_invalid_payload", None

        access_token = body.get("accessToken")
        if not isinstance(access_token, str) or not access_token.strip():
            return "token_fetch_missing_access_token", None
        expire_in = body.get("expireIn")
        ttl = float(expire_in) if isinstance(expire_in, (int, float)) else 7200.0

        self._access_token = access_token
        self._access_token_expire_at = now + max(ttl, 60.0)
        return None, self._access_token
