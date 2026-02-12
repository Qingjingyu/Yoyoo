class IMUserBinder:
    """In-memory IM user binding for MVP bootstrap."""

    def __init__(self) -> None:
        self._bindings: dict[tuple[str, str], str] = {}

    def bind(self, platform: str, platform_user_id: str) -> str:
        key = (platform, platform_user_id)
        if key not in self._bindings:
            safe_user_id = platform_user_id.replace(" ", "_")
            self._bindings[key] = f"user_{platform}_{safe_user_id}"
        return self._bindings[key]

