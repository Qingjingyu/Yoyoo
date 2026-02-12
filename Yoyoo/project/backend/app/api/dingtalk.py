from __future__ import annotations

import logging
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, status

from app.container import ServiceContainer
from app.intelligence.models import Channel, ChatScope
from app.schemas import DingtalkEventResponse
from app.services.ingress_service import DeterministicIngressService, IngressEnvelope

router = APIRouter(prefix="/api/v1/dingtalk", tags=["dingtalk"])
logger = logging.getLogger(__name__)
_ingress_service = DeterministicIngressService()


def _get_container(request: Request) -> ServiceContainer:
    return request.app.state.container


@router.post("/events")
async def receive_events(request: Request) -> DingtalkEventResponse | dict[str, Any]:
    container = _get_container(request)
    trace_id = getattr(request.state, "trace_id", str(uuid4()))
    raw_body = await request.body()
    payload: dict[str, Any] = await request.json()

    event_service = container.dingtalk_event_service
    if not event_service.verify_signature(
        raw_body=raw_body,
        timestamp=request.headers.get("x-dingtalk-timestamp"),
        nonce=request.headers.get("x-dingtalk-nonce"),
        signature=request.headers.get("x-dingtalk-signature"),
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid DingTalk signature.",
        )

    if event_service.is_url_verification(payload):
        challenge = str(payload["challenge"])
        return {"challenge": challenge}

    incoming = event_service.parse_message(payload)
    if incoming is None:
        logger.info(
            "dingtalk_event_ignored trace_id=%s event_type=%s msgtype=%s keys=%s",
            trace_id,
            str(payload.get("eventType") or ""),
            str(payload.get("msgtype") or ""),
            sorted(payload.keys())[:12],
        )
        return DingtalkEventResponse(ok=True, ignored=True, trace_id=trace_id)

    logger.info(
        "dingtalk_event trace_id=%s event_id=%s conversation_id=%s sender=%s",
        trace_id,
        incoming.event_id,
        incoming.conversation_id,
        incoming.sender_user_id,
    )
    is_new_persistent_ingress = container.memory_service.register_processed_ingress(
        platform="dingtalk",
        conversation_id=incoming.conversation_id,
        message_id=incoming.event_id,
        trace_id=trace_id,
    )
    if not is_new_persistent_ingress:
        logger.info(
            "dingtalk_event_deduped trace_id=%s event_id=%s conversation_id=%s mode=persistent",
            trace_id,
            incoming.event_id,
            incoming.conversation_id,
        )
        return DingtalkEventResponse(
            ok=True,
            ignored=True,
            trace_id=trace_id,
            event_id=incoming.event_id,
            reason="duplicate_event_deduped",
        )

    yoyoo_user_id = container.im_user_binder.bind(
        platform="dingtalk",
        platform_user_id=incoming.sender_user_id,
    )
    session = container.im_session_manager.get_or_create(
        yoyoo_user_id=yoyoo_user_id,
        platform="dingtalk",
        conversation_id=incoming.conversation_id,
    )
    resolved_task_hint = incoming.task_id_hint
    if not resolved_task_hint and incoming.quoted_message_id:
        resolved_task_hint = container.memory_service.resolve_external_message_task(
            platform="dingtalk",
            conversation_id=incoming.conversation_id,
            message_id=incoming.quoted_message_id,
        )
        if resolved_task_hint:
            logger.info(
                "dingtalk_feedback_quote_mapping_hit trace_id=%s conversation_id=%s "
                "quoted_message_id=%s task_id=%s",
                trace_id,
                incoming.conversation_id,
                incoming.quoted_message_id,
                resolved_task_hint,
            )

    envelope = IngressEnvelope(
        user_id=session.yoyoo_user_id,
        conversation_id=incoming.conversation_id,
        channel=Channel.DINGTALK,
        scope=ChatScope.GROUP if incoming.scope == "group" else ChatScope.PRIVATE,
        trace_id=trace_id,
        text=incoming.text,
        task_id_hint=resolved_task_hint,
        is_mentioned=incoming.is_mentioned,
        trusted=container.is_trusted_user(incoming.sender_user_id)
        or container.is_trusted_user(session.yoyoo_user_id),
    )
    result = container.yoyoo_brain.handle_message(
        context=_ingress_service.build_context(envelope),
        text=_ingress_service.normalize_text(
            text=envelope.text,
            task_id_hint=envelope.task_id_hint,
        ),
    )
    binding_task_id = result.decision.task_id or resolved_task_hint
    if binding_task_id:
        container.memory_service.bind_external_message_task(
            platform="dingtalk",
            conversation_id=incoming.conversation_id,
            message_id=incoming.event_id,
            task_id=binding_task_id,
        )
        if incoming.quoted_message_id:
            container.memory_service.bind_external_message_task(
                platform="dingtalk",
                conversation_id=incoming.conversation_id,
                message_id=incoming.quoted_message_id,
                task_id=binding_task_id,
            )
    if result.decision.should_reply and result.reply:
        container.dingtalk_client.send_text(
            conversation_id=incoming.conversation_id,
            text=result.reply,
            session_webhook=incoming.session_webhook,
            trace_id=trace_id,
        )

    return DingtalkEventResponse(
        ok=True,
        trace_id=trace_id,
        event_id=incoming.event_id,
        session_key=session.session_key,
        reply=result.reply if result.decision.should_reply else None,
        ignored=not result.decision.should_reply,
        reason=result.decision.reason,
        route_model=result.decision.route_model,
        plan_steps=result.decision.plan_steps,
        verification_checks=result.decision.verification_checks,
        rollback_template=result.decision.rollback_template,
        task_id=result.decision.task_id,
        strategy_cards=result.decision.strategy_cards,
        strategy_id=result.decision.strategy_id,
        execution_quality_score=result.decision.execution_quality_score,
        execution_quality_issues=result.decision.execution_quality_issues,
        execution_corrected=result.decision.execution_corrected,
        execution_duration_ms=result.decision.execution_duration_ms,
        evidence_structured=result.decision.evidence_structured,
        yyos_stage=result.decision.yyos_stage,
        yyos_confidence=result.decision.yyos_confidence,
        yyos_risk_level=result.decision.yyos_risk_level,
        yyos_decision=result.decision.yyos_decision,
        yyos_recommended_skills=result.decision.yyos_recommended_skills,
    )
