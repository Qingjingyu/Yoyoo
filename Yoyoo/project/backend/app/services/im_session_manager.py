from dataclasses import dataclass
from datetime import UTC, datetime


@dataclass
class IMSession:
    session_key: str
    yoyoo_user_id: str
    platform: str
    conversation_id: str
    last_active_at: datetime


class IMSessionManager:
    """In-memory session manager for multi-user/multi-conversation isolation."""

    def __init__(self) -> None:
        self._sessions: dict[str, IMSession] = {}

    def get_or_create(
        self,
        *,
        yoyoo_user_id: str,
        platform: str,
        conversation_id: str,
    ) -> IMSession:
        session_key = f"{yoyoo_user_id}_{platform}_{conversation_id}"
        now = datetime.now(UTC)
        session = self._sessions.get(session_key)
        if session is None:
            session = IMSession(
                session_key=session_key,
                yoyoo_user_id=yoyoo_user_id,
                platform=platform,
                conversation_id=conversation_id,
                last_active_at=now,
            )
            self._sessions[session_key] = session
        else:
            session.last_active_at = now
        return session

