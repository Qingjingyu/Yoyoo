class ChatService:
    """Temporary chat service. Replace with real LLM integration in next phase."""

    model_name = "local/mock"

    def reply(self, message: str) -> str:
        return f"[echo] {message}"

