from app.services.chat_service import ChatService


class IMMessageRouter:
    """Route IM messages into chat service and return text replies."""

    def __init__(self, chat_service: ChatService) -> None:
        self._chat_service = chat_service

    def route_text(
        self,
        *,
        yoyoo_user_id: str,
        session_key: str,
        message: str,
    ) -> str:
        _ = (yoyoo_user_id, session_key)  # Reserved for memory/routing rules in next phase.
        return self._chat_service.reply(message)

