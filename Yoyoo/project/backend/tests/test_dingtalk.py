import base64
import hashlib
import hmac
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.container import build_container
from app.main import app
from app.services.dingtalk import DingtalkEventService

client = TestClient(app)


def _sign(secret: str, raw_body: bytes, timestamp: str, nonce: str) -> str:
    data = f"{timestamp}\n{nonce}\n".encode() + raw_body
    digest = hmac.new(secret.encode("utf-8"), data, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("utf-8")


class _FakeHTTPResponse:
    def __init__(self, *, status: int, payload: dict[str, object]) -> None:
        self._status = status
        self._payload = payload

    def __enter__(self) -> "_FakeHTTPResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        _ = (exc_type, exc, tb)
        return False

    def getcode(self) -> int:
        return self._status

    def read(self) -> bytes:
        return json.dumps(self._payload).encode("utf-8")


@pytest.fixture(autouse=True)
def _reset_container(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("YOYOO_MEMORY_FILE", str(tmp_path / "memory.json"))
    app.state.container = build_container()


def test_dingtalk_challenge() -> None:
    response = client.post("/api/v1/dingtalk/events", json={"challenge": "abc123"})

    assert response.status_code == 200
    assert response.json() == {"challenge": "abc123"}


def test_dingtalk_message_roundtrip() -> None:
    payload = {
        "eventType": "chat_message",
        "eventId": "evt_001",
        "senderStaffId": "staff_001",
        "conversationId": "conv_001",
        "text": {"content": "你好"},
    }
    response = client.post("/api/v1/dingtalk/events", json=payload)

    body = response.json()
    assert response.status_code == 200
    assert body["ok"] is True
    assert body["event_id"] == "evt_001"
    assert isinstance(body["trace_id"], str)
    assert body["trace_id"]
    assert "你好" in body["reply"]
    assert body["route_model"] == "minimax/MiniMax-M2.1"
    assert body["session_key"] == "user_dingtalk_staff_001_dingtalk_conv_001"
    assert body["execution_quality_score"] is None
    assert body["execution_corrected"] is False

    sent = app.state.container.dingtalk_client.sent_messages[-1]
    assert sent.platform == "dingtalk"
    assert sent.conversation_id == "conv_001"
    assert sent.trace_id == body["trace_id"]
    assert "你好" in sent.text


def test_dingtalk_duplicate_event_is_deduped() -> None:
    payload = {
        "eventType": "chat_message",
        "eventId": "evt_dup_001",
        "senderStaffId": "staff_dup_001",
        "conversationId": "conv_dup_001",
        "text": {"content": "请执行一个部署任务并反馈"},
    }

    first = client.post("/api/v1/dingtalk/events", json=payload)
    first_body = first.json()
    assert first.status_code == 200
    assert first_body["ok"] is True
    assert first_body["ignored"] is False
    assert isinstance(first_body["task_id"], str)

    second = client.post("/api/v1/dingtalk/events", json=payload)
    second_body = second.json()
    assert second.status_code == 200
    assert second_body["ok"] is True
    assert second_body["ignored"] is True
    assert second_body["reason"] == "duplicate_event_deduped"

    tasks = app.state.container.memory_service.recent_tasks("conv_dup_001", limit=10)
    assert len(tasks) == 1
    assert tasks[0].task_id == first_body["task_id"]
    assert len(app.state.container.dingtalk_client.sent_messages) == 1


def test_dingtalk_duplicate_event_is_deduped_after_container_restart() -> None:
    payload = {
        "eventType": "chat_message",
        "eventId": "evt_dup_restart_001",
        "senderStaffId": "staff_dup_restart_001",
        "conversationId": "conv_dup_restart_001",
        "text": {"content": "请执行一个部署任务并反馈"},
    }

    first = client.post("/api/v1/dingtalk/events", json=payload)
    first_body = first.json()
    assert first.status_code == 200
    assert first_body["ok"] is True
    assert first_body["ignored"] is False
    assert isinstance(first_body["task_id"], str)

    app.state.container = build_container()

    second = client.post("/api/v1/dingtalk/events", json=payload)
    second_body = second.json()
    assert second.status_code == 200
    assert second_body["ok"] is True
    assert second_body["ignored"] is True
    assert second_body["reason"] == "duplicate_event_deduped"

    tasks = app.state.container.memory_service.recent_tasks("conv_dup_restart_001", limit=10)
    assert len(tasks) == 1
    assert tasks[0].task_id == first_body["task_id"]
    assert len(app.state.container.dingtalk_client.sent_messages) == 0


def test_dingtalk_non_chat_event_type_still_processed() -> None:
    payload = {
        "eventType": "im.message.receive_v2",
        "eventId": "evt_non_chat_001",
        "senderStaffId": "staff_non_chat_001",
        "conversationId": "conv_non_chat_001",
        "text": {"content": "你好"},
    }
    response = client.post("/api/v1/dingtalk/events", json=payload)

    body = response.json()
    assert response.status_code == 200
    assert body["ok"] is True
    assert body["ignored"] is False
    assert "你好" in (body["reply"] or "")


def test_dingtalk_rich_text_content_processed() -> None:
    payload = {
        "msgId": "msg_rich_001",
        "msgtype": "richText",
        "chatbotUserId": "staff_rich_001",
        "conversationId": "conv_rich_001",
        "conversationType": "1",
        "content": json.dumps(
            {
                "richText": [
                    {"type": "text", "text": "PING-CB-STAR-2244"},
                ]
            },
            ensure_ascii=False,
        ),
    }
    response = client.post("/api/v1/dingtalk/events", json=payload)

    body = response.json()
    assert response.status_code == 200
    assert body["ok"] is True
    assert body["ignored"] is False
    assert body["event_id"] == "msg_rich_001"
    assert "PING-CB-STAR-2244" in (body["reply"] or "")


def test_dingtalk_invalid_signature_rejected() -> None:
    app.state.container.dingtalk_event_service.secret = "topsecret"
    payload = {
        "eventType": "chat_message",
        "senderStaffId": "staff_001",
        "conversationId": "conv_001",
        "text": {"content": "hi"},
    }

    response = client.post(
        "/api/v1/dingtalk/events",
        json=payload,
        headers={
            "x-dingtalk-timestamp": "1700000000",
            "x-dingtalk-nonce": "nonce-001",
            "x-dingtalk-signature": "invalid-signature",
        },
    )

    assert response.status_code == 401


def test_dingtalk_valid_signature_passes() -> None:
    secret = "topsecret"
    app.state.container.dingtalk_event_service.secret = secret
    payload = {
        "eventType": "chat_message",
        "eventId": "evt_sig",
        "senderStaffId": "staff_sig",
        "conversationId": "conv_sig",
        "text": {"content": "signed"},
    }
    raw_body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    timestamp = "1700000000"
    nonce = "nonce-xyz"
    signature = _sign(secret, raw_body, timestamp, nonce)

    response = client.post(
        "/api/v1/dingtalk/events",
        content=raw_body,
        headers={
            "content-type": "application/json",
            "x-dingtalk-timestamp": timestamp,
            "x-dingtalk-nonce": nonce,
            "x-dingtalk-signature": signature,
        },
    )

    body = response.json()
    assert response.status_code == 200
    assert body["ok"] is True
    assert body["event_id"] == "evt_sig"


def test_dingtalk_group_message_without_mention_is_ignored() -> None:
    payload = {
        "eventType": "chat_message",
        "eventId": "evt_group_001",
        "senderStaffId": "staff_group_001",
        "conversationId": "conv_group_001",
        "conversationType": "2",
        "text": {"content": "大家好"},
    }

    response = client.post("/api/v1/dingtalk/events", json=payload)
    body = response.json()

    assert response.status_code == 200
    assert body["ok"] is True
    assert body["ignored"] is True
    assert body["reply"] is None
    assert body["reason"] == "group_message_without_mention"
    assert body["route_model"] == "minimax/MiniMax-M2.1"
    assert app.state.container.dingtalk_client.sent_messages == []


def test_dingtalk_group_message_with_mention_gets_reply() -> None:
    payload = {
        "eventType": "chat_message",
        "eventId": "evt_group_002",
        "senderStaffId": "staff_group_002",
        "conversationId": "conv_group_002",
        "conversationType": "2",
        "isInAtList": True,
        "text": {"content": "你好"},
    }

    response = client.post("/api/v1/dingtalk/events", json=payload)
    body = response.json()

    assert response.status_code == 200
    assert body["ok"] is True
    assert body["ignored"] is False
    assert "你好" in body["reply"]
    assert app.state.container.dingtalk_client.sent_messages


def test_dingtalk_event_service_extracts_task_id_from_quote() -> None:
    service = DingtalkEventService()
    payload = {
        "eventType": "chat_message",
        "eventId": "evt_quote_001",
        "senderStaffId": "staff_quote_001",
        "conversationId": "conv_quote_001",
        "text": {"content": "这次不行"},
        "replyMessage": {
            "msgId": "quoted_msg_001",
            "text": {
                "content": "任务台账ID：task_20260206153641_0e72bec2",
            }
        },
    }

    incoming = service.parse_message(payload)

    assert incoming is not None
    assert incoming.task_id_hint == "task_20260206153641_0e72bec2"
    assert incoming.quoted_message_id == "quoted_msg_001"


def test_dingtalk_direct_feedback_updates_recent_task() -> None:
    first_payload = {
        "eventType": "chat_message",
        "eventId": "evt_fb_001",
        "senderStaffId": "staff_fb_001",
        "conversationId": "conv_fb_001",
        "text": {"content": "请执行一个部署任务并反馈"},
    }
    first_response = client.post("/api/v1/dingtalk/events", json=first_payload)
    assert first_response.status_code == 200
    first_task_id = first_response.json()["task_id"]
    assert isinstance(first_task_id, str)

    second_payload = {
        "eventType": "chat_message",
        "eventId": "evt_fb_002",
        "senderStaffId": "staff_fb_001",
        "conversationId": "conv_fb_001",
        "text": {"content": "这次做得很好"},
    }
    second_response = client.post("/api/v1/dingtalk/events", json=second_payload)
    second_body = second_response.json()
    assert second_response.status_code == 200
    assert second_body["task_id"] == first_task_id
    assert "已记录正向反馈" in (second_body["reply"] or "")
    tasks = app.state.container.memory_service.recent_tasks("conv_fb_001", limit=5)
    matched = [item for item in tasks if item.task_id == first_task_id]
    assert matched
    assert matched[0].user_id.startswith("user_dingtalk_")


def test_dingtalk_reply_quote_feedback_targets_referenced_task() -> None:
    first_payload = {
        "eventType": "chat_message",
        "eventId": "evt_quote_fb_001",
        "senderStaffId": "staff_quote_fb_001",
        "conversationId": "conv_quote_fb_001",
        "text": {"content": "请执行一个部署任务并反馈"},
    }
    first_response = client.post("/api/v1/dingtalk/events", json=first_payload)
    assert first_response.status_code == 200
    first_task_id = first_response.json()["task_id"]
    assert isinstance(first_task_id, str)

    second_payload = {
        "eventType": "chat_message",
        "eventId": "evt_quote_fb_002",
        "senderStaffId": "staff_quote_fb_001",
        "conversationId": "conv_quote_fb_001",
        "text": {"content": "这次不行"},
        "replyMessage": {
            "text": {
                "content": f"引用：任务台账ID {first_task_id}",
            }
        },
    }
    second_response = client.post("/api/v1/dingtalk/events", json=second_payload)
    second_body = second_response.json()
    assert second_response.status_code == 200
    assert second_body["task_id"] == first_task_id
    assert "已记录负向反馈" in (second_body["reply"] or "")


def test_dingtalk_quote_message_id_mapping_targets_task_without_task_id() -> None:
    first_payload = {
        "eventType": "chat_message",
        "eventId": "evt_map_001",
        "senderStaffId": "staff_map_001",
        "conversationId": "conv_map_001",
        "text": {"content": "请执行一个部署任务并反馈"},
    }
    first_response = client.post("/api/v1/dingtalk/events", json=first_payload)
    assert first_response.status_code == 200
    first_task_id = first_response.json()["task_id"]
    assert isinstance(first_task_id, str)

    second_payload = {
        "eventType": "chat_message",
        "eventId": "evt_map_002",
        "senderStaffId": "staff_map_001",
        "conversationId": "conv_map_001",
        "text": {"content": "这次很好"},
        "replyMessage": {
            "messageId": "evt_map_001",
            "text": {
                "content": "引用上一条消息",
            },
        },
    }
    second_response = client.post("/api/v1/dingtalk/events", json=second_payload)
    second_body = second_response.json()

    assert second_response.status_code == 200
    assert second_body["task_id"] == first_task_id
    assert "已记录正向反馈" in (second_body["reply"] or "")


def test_dingtalk_private_feedback_relaxed_binding_when_sender_changes() -> None:
    first_payload = {
        "eventType": "chat_message",
        "eventId": "evt_private_relaxed_bind_001",
        "senderStaffId": "staff_private_relaxed_a",
        "conversationId": "conv_private_relaxed_bind_001",
        "text": {"content": "请执行一个部署任务并反馈"},
    }
    first_response = client.post("/api/v1/dingtalk/events", json=first_payload)
    assert first_response.status_code == 200
    first_task_id = first_response.json()["task_id"]
    assert isinstance(first_task_id, str)

    second_payload = {
        "eventType": "chat_message",
        "eventId": "evt_private_relaxed_bind_002",
        "senderStaffId": "staff_private_relaxed_b",
        "conversationId": "conv_private_relaxed_bind_001",
        "text": {"content": "这次不行"},
    }
    second_response = client.post("/api/v1/dingtalk/events", json=second_payload)
    second_body = second_response.json()

    assert second_response.status_code == 200
    assert second_body["task_id"] == first_task_id
    assert "私聊会话兜底" in (second_body["reply"] or "")


def test_dingtalk_task_reply_includes_strategy_brief_after_learning() -> None:
    base_payload = {
        "eventType": "chat_message",
        "senderStaffId": "staff_strategy_brief_001",
        "conversationId": "conv_strategy_brief_001",
        "text": {"content": "继续部署后端服务"},
    }
    for index in range(1, 3):
        payload = dict(base_payload)
        payload["eventId"] = f"evt_strategy_brief_seed_{index}"
        response = client.post("/api/v1/dingtalk/events", json=payload)
        assert response.status_code == 200
        assert response.json()["ok"] is True

    third_payload = dict(base_payload)
    third_payload["eventId"] = "evt_strategy_brief_003"
    third_response = client.post("/api/v1/dingtalk/events", json=third_payload)
    third_body = third_response.json()

    assert third_response.status_code == 200
    assert isinstance(third_body["strategy_id"], str)
    assert third_body["strategy_id"]
    assert "本次采用策略" in (third_body["reply"] or "")
    sent = app.state.container.dingtalk_client.sent_messages[-1]
    assert "本次采用策略" in sent.text


def test_dingtalk_with_session_webhook_delivers_message(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DINGTALK_CLIENT_ID", "cid_test")
    monkeypatch.setenv("DINGTALK_CLIENT_SECRET", "csec_test")
    app.state.container = build_container()

    def _fake_urlopen(request, timeout: float):  # type: ignore[no-untyped-def]
        _ = timeout
        if request.full_url.endswith("/v1.0/oauth2/accessToken"):
            return _FakeHTTPResponse(
                status=200,
                payload={"accessToken": "token_123", "expireIn": 7200},
            )
        if request.full_url.startswith("https://oapi.dingtalk.com/robot/sendBySession"):
            return _FakeHTTPResponse(status=200, payload={"success": True})
        raise AssertionError(f"unexpected url: {request.full_url}")

    monkeypatch.setattr("app.services.dingtalk_client.urlopen", _fake_urlopen)

    payload = {
        "eventType": "chat_message",
        "eventId": "evt_session_001",
        "senderStaffId": "staff_session_001",
        "conversationId": "conv_session_001",
        "text": {"content": "你好"},
        "sessionWebhook": "https://oapi.dingtalk.com/robot/sendBySession?session=abc123",
    }
    response = client.post("/api/v1/dingtalk/events", json=payload)

    body = response.json()
    assert response.status_code == 200
    assert body["ok"] is True
    assert isinstance(body["trace_id"], str)
    assert body["trace_id"]

    sent = app.state.container.dingtalk_client.sent_messages[-1]
    assert sent.session_webhook == payload["sessionWebhook"]
    assert sent.trace_id == body["trace_id"]
    assert sent.delivered is True
    assert sent.error is None


def test_dingtalk_without_session_webhook_uses_proactive_group_send(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DINGTALK_CLIENT_ID", "cid_test")
    monkeypatch.setenv("DINGTALK_CLIENT_SECRET", "csec_test")
    monkeypatch.setenv("DINGTALK_ROBOT_CODE", "cid_test")
    app.state.container = build_container()

    captured_payload: dict[str, object] = {}

    def _fake_urlopen(request, timeout: float):  # type: ignore[no-untyped-def]
        _ = timeout
        if request.full_url.endswith("/v1.0/oauth2/accessToken"):
            return _FakeHTTPResponse(
                status=200,
                payload={"accessToken": "token_123", "expireIn": 7200},
            )
        if request.full_url == "https://api.dingtalk.com/v1.0/robot/groupMessages/send":
            payload = json.loads(request.data.decode("utf-8"))
            captured_payload.update(payload)
            return _FakeHTTPResponse(status=200, payload={"errcode": 0})
        raise AssertionError(f"unexpected url: {request.full_url}")

    monkeypatch.setattr("app.services.dingtalk_client.urlopen", _fake_urlopen)

    payload = {
        "eventType": "chat_message",
        "eventId": "evt_proactive_group_001",
        "senderStaffId": "staff_proactive_group_001",
        "conversationId": "cid_proactive_group_001",
        "conversationType": "2",
        "isInAtList": True,
        "text": {"content": "你好"},
    }
    response = client.post("/api/v1/dingtalk/events", json=payload)

    body = response.json()
    assert response.status_code == 200
    assert body["ok"] is True

    sent = app.state.container.dingtalk_client.sent_messages[-1]
    assert sent.session_webhook is None
    assert sent.delivered is True
    assert sent.error is None
    assert captured_payload["openConversationId"] == "cid_proactive_group_001"
    assert captured_payload["robotCode"] == "cid_test"


def test_dingtalk_event_service_fallbacks_to_session_webhook_hash() -> None:
    service = DingtalkEventService()
    payload = {
        "eventId": "evt_webhook_only_001",
        "chatbotUserId": "bot_001",
        "text": {"content": "你好"},
        "sessionWebhook": "https://oapi.dingtalk.com/robot/sendBySession?session=xyz",
    }

    incoming = service.parse_message(payload)

    assert incoming is not None
    assert incoming.conversation_id.startswith("session:")
