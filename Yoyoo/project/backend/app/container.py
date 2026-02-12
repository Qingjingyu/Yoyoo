from __future__ import annotations

from dataclasses import dataclass
from os import getenv

from app.intelligence.brain import YoyooBrain
from app.intelligence.ceo_dispatcher import CEODispatcher
from app.intelligence.execution_quality import ExecutionQualityGuard
from app.intelligence.memory import MemoryService
from app.intelligence.model_router import ModelRouter
from app.intelligence.planner import TaskPlanner
from app.intelligence.policy_guard import PolicyGuard
from app.intelligence.research_playbook import ResearchPlaybook
from app.intelligence.verification import TaskVerifier
from app.intelligence.yyos_orchestrator import YYOSOrchestrator
from app.services.chat_service import ChatService
from app.services.dingtalk import DingtalkEventService
from app.services.dingtalk_client import DingtalkClient
from app.services.executor_adapter import ExecutorAdapter
from app.services.im_message_router import IMMessageRouter
from app.services.im_session_manager import IMSessionManager
from app.services.im_user_binder import IMUserBinder
from app.services.memory_sidecar import MemorySidecarClient
from app.services.openclaw_adapter import OpenClawAdapter


@dataclass
class ServiceContainer:
    chat_service: ChatService
    memory_service: MemoryService
    policy_guard: PolicyGuard
    yoyoo_brain: YoyooBrain
    dingtalk_event_service: DingtalkEventService
    dingtalk_client: DingtalkClient
    im_user_binder: IMUserBinder
    im_session_manager: IMSessionManager
    im_message_router: IMMessageRouter
    memory_sidecar: MemorySidecarClient
    yyos_orchestrator: YYOSOrchestrator
    executor_adapter: ExecutorAdapter
    ceo_dispatcher: CEODispatcher
    trusted_user_ids: set[str]

    def is_trusted_user(self, user_id: str) -> bool:
        return user_id in self.trusted_user_ids


def build_container() -> ServiceContainer:
    chat_service = ChatService()
    memory_service = MemoryService(
        storage_path=getenv("YOYOO_MEMORY_FILE", "./data/yoyoo_memory.json"),
    )
    policy_guard = PolicyGuard()
    model_router = ModelRouter()
    task_planner = TaskPlanner(playbook=ResearchPlaybook())
    task_verifier = TaskVerifier()
    execution_quality_guard = ExecutionQualityGuard()
    memory_sidecar = MemorySidecarClient(
        enabled=_parse_bool(getenv("YOYOO_MEMORY_SIDECAR_ENABLED"), default=False),
        base_url=getenv("YOYOO_MEMORY_SIDECAR_URL"),
        token=getenv("YOYOO_MEMORY_SIDECAR_TOKEN"),
        timeout_sec=_parse_float(getenv("YOYOO_MEMORY_SIDECAR_TIMEOUT_SEC"), default=3.0),
        retrieve_path=getenv("YOYOO_MEMORY_SIDECAR_RETRIEVE_PATH", "/api/v1/retrieve"),
    )
    yyos_orchestrator = YYOSOrchestrator(
        enabled=_parse_bool(getenv("YOYOO_YYOS_ENABLED"), default=True),
        cli_bin=getenv("YOYOO_YYOS_BIN", "yyos"),
        timeout_sec=_parse_float(getenv("YOYOO_YYOS_TIMEOUT_SEC"), default=8.0),
    )
    openclaw_adapter = OpenClawAdapter(
        bridge_url=getenv("OPENCLAW_BRIDGE_URL"),
        bridge_token=getenv("OPENCLAW_BRIDGE_TOKEN"),
        bridge_retries=_parse_int(getenv("OPENCLAW_BRIDGE_RETRIES"), default=0),
        timeout_sec=_parse_float(getenv("OPENCLAW_BRIDGE_TIMEOUT_SEC"), default=20.0),
        exec_timeout_sec=_parse_float(getenv("OPENCLAW_EXEC_TIMEOUT_SEC"), default=45.0),
        local_exec_enabled=_parse_bool(getenv("OPENCLAW_LOCAL_EXEC"), default=False),
        fallback_to_ssh_on_local_failure=_parse_bool(
            getenv("OPENCLAW_FALLBACK_TO_SSH_ON_LOCAL_FAILURE"),
            default=True,
        ),
        local_healthcheck_ttl_sec=_parse_float(
            getenv("OPENCLAW_LOCAL_HEALTHCHECK_TTL_SEC"),
            default=60.0,
        ),
        retry_policy_file=getenv("OPENCLAW_RETRY_POLICY_FILE"),
        retry_policy_reload_sec=_parse_float(
            getenv("OPENCLAW_RETRY_POLICY_RELOAD_SEC"),
            default=5.0,
        ),
        ssh_host=getenv("OPENCLAW_SSH_HOST"),
        ssh_user=getenv("OPENCLAW_SSH_USER", "root"),
        ssh_key_path=getenv("OPENCLAW_SSH_KEY_PATH"),
        ssh_port=_parse_int(getenv("OPENCLAW_SSH_PORT"), default=22),
        remote_openclaw_bin=getenv("OPENCLAW_REMOTE_OPENCLAW_BIN", "openclaw"),
        circuit_breaker_failure_threshold=_parse_int(
            getenv("OPENCLAW_CIRCUIT_BREAKER_FAILURE_THRESHOLD"),
            default=5,
        ),
        circuit_breaker_open_sec=_parse_float(
            getenv("OPENCLAW_CIRCUIT_BREAKER_OPEN_SEC"),
            default=30.0,
        ),
        session_strategy=getenv("OPENCLAW_SESSION_STRATEGY", "conversation"),
        session_lock_retries=_parse_int(getenv("OPENCLAW_SESSION_LOCK_RETRIES"), default=1),
    )
    executor_adapter = ExecutorAdapter(openclaw_adapter=openclaw_adapter)
    ceo_dispatcher = CEODispatcher(
        memory_service=memory_service,
        executor_adapter=executor_adapter,
    )
    trusted_user_ids = {
        uid.strip()
        for uid in getenv("YOYOO_TRUSTED_USER_IDS", "").split(",")
        if uid.strip()
    }

    return ServiceContainer(
        chat_service=chat_service,
        memory_service=memory_service,
        policy_guard=policy_guard,
        yoyoo_brain=YoyooBrain(
            chat_service=chat_service,
            memory_service=memory_service,
            policy_guard=policy_guard,
            model_router=model_router,
            task_planner=task_planner,
            task_verifier=task_verifier,
            openclaw_adapter=openclaw_adapter,
            execution_quality_guard=execution_quality_guard,
            yyos_orchestrator=yyos_orchestrator,
            memory_sidecar=memory_sidecar,
            feedback_binding_explain_enabled=_parse_bool(
                getenv("YOYOO_FEEDBACK_BINDING_EXPLAIN"),
                default=True,
            ),
        ),
        dingtalk_event_service=DingtalkEventService(
            secret=getenv("DINGTALK_SIGNATURE_SECRET"),
        ),
        dingtalk_client=DingtalkClient(
            client_id=getenv("DINGTALK_CLIENT_ID"),
            client_secret=getenv("DINGTALK_CLIENT_SECRET"),
            robot_code=getenv("DINGTALK_ROBOT_CODE") or getenv("DINGTALK_CLIENT_ID"),
            timeout_sec=_parse_float(getenv("DINGTALK_SEND_TIMEOUT_SEC"), default=8.0),
        ),
        im_user_binder=IMUserBinder(),
        im_session_manager=IMSessionManager(),
        im_message_router=IMMessageRouter(chat_service=chat_service),
        memory_sidecar=memory_sidecar,
        yyos_orchestrator=yyos_orchestrator,
        executor_adapter=executor_adapter,
        ceo_dispatcher=ceo_dispatcher,
        trusted_user_ids=trusted_user_ids,
    )


def _parse_int(value: str | None, *, default: int) -> int:
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _parse_float(value: str | None, *, default: float) -> float:
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _parse_bool(value: str | None, *, default: bool) -> bool:
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return default
