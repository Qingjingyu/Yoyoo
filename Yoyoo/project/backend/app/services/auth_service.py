from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

AuthLoginType = Literal["phone", "email"]

_PHONE_PATTERN = re.compile(r"^\+?[0-9]{8,16}$")
_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_USER_TOKEN_PATTERN = re.compile(r"[a-z0-9]+")


@dataclass(slots=True)
class VerificationTicket:
    login_type: AuthLoginType
    identifier: str
    code_hash: str
    issued_at: datetime
    expires_at: datetime
    cooldown_until: datetime
    attempts: int = 0
    max_attempts: int = 5


@dataclass(slots=True)
class SessionRecord:
    token: str
    user_id: str
    identity: str
    created_at: datetime
    expires_at: datetime


@dataclass(slots=True)
class SendCodeResult:
    cooldown_sec: int
    expires_at: datetime
    message: str
    dev_code: str | None = None


class AuthService:
    def __init__(
        self,
        *,
        code_ttl_sec: int = 300,
        cooldown_sec: int = 60,
        session_ttl_sec: int = 86400 * 7,
    ) -> None:
        self._code_ttl_sec = max(code_ttl_sec, 60)
        self._cooldown_sec = max(cooldown_sec, 10)
        self._session_ttl_sec = max(session_ttl_sec, 3600)
        self._salt = os.getenv("YOYOO_AUTH_SALT", "yoyoo-auth-salt")
        self._tickets: dict[str, VerificationTicket] = {}
        self._sessions: dict[str, SessionRecord] = {}
        self._identifier_to_user_id: dict[str, str] = {}

    def send_code(
        self,
        *,
        login_type: AuthLoginType,
        identifier: str,
    ) -> SendCodeResult:
        normalized_identifier = self._normalize_identifier(
            login_type=login_type,
            identifier=identifier,
        )
        key = self._ticket_key(login_type=login_type, identifier=normalized_identifier)
        now = datetime.now(UTC)
        existing = self._tickets.get(key)
        if existing and existing.cooldown_until > now:
            remain = int((existing.cooldown_until - now).total_seconds())
            raise ValueError(f"请求过于频繁，请 {max(remain, 1)} 秒后再试。")

        code = self._generate_code()
        ticket = VerificationTicket(
            login_type=login_type,
            identifier=normalized_identifier,
            code_hash=self._hash_code(code),
            issued_at=now,
            expires_at=now + timedelta(seconds=self._code_ttl_sec),
            cooldown_until=now + timedelta(seconds=self._cooldown_sec),
        )
        self._tickets[key] = ticket
        dev_code = code if self._expose_dev_code() else None
        return SendCodeResult(
            cooldown_sec=self._cooldown_sec,
            expires_at=ticket.expires_at,
            message="验证码已发送，请查收。",
            dev_code=dev_code,
        )

    def verify_code(
        self,
        *,
        login_type: AuthLoginType,
        identifier: str,
        code: str,
    ) -> SessionRecord:
        normalized_identifier = self._normalize_identifier(
            login_type=login_type,
            identifier=identifier,
        )
        key = self._ticket_key(login_type=login_type, identifier=normalized_identifier)
        ticket = self._tickets.get(key)
        now = datetime.now(UTC)
        if ticket is None:
            raise ValueError("请先发送验证码。")
        if ticket.expires_at < now:
            self._tickets.pop(key, None)
            raise ValueError("验证码已过期，请重新发送。")

        normalized_code = (code or "").strip()
        if not re.fullmatch(r"[0-9]{6}", normalized_code):
            raise ValueError("验证码格式错误。")

        expected_hash = ticket.code_hash
        incoming_hash = self._hash_code(normalized_code)
        if not hmac.compare_digest(expected_hash, incoming_hash):
            ticket.attempts += 1
            if ticket.attempts >= ticket.max_attempts:
                self._tickets.pop(key, None)
                raise ValueError("验证码错误次数过多，请重新发送。")
            raise ValueError("验证码错误或已过期。")

        self._tickets.pop(key, None)
        user_id = self._identifier_to_user_id.get(key)
        if user_id is None:
            user_id = self._make_user_id(normalized_identifier)
            self._identifier_to_user_id[key] = user_id
        token = secrets.token_urlsafe(32)
        session = SessionRecord(
            token=token,
            user_id=user_id,
            identity=normalized_identifier,
            created_at=now,
            expires_at=now + timedelta(seconds=self._session_ttl_sec),
        )
        self._sessions[token] = session
        self._prune_expired_sessions(now=now)
        return session

    def get_session(self, *, token: str) -> SessionRecord | None:
        normalized = (token or "").strip()
        if not normalized:
            return None
        session = self._sessions.get(normalized)
        if session is None:
            return None
        now = datetime.now(UTC)
        if session.expires_at < now:
            self._sessions.pop(normalized, None)
            return None
        return session

    def _prune_expired_sessions(self, *, now: datetime) -> None:
        expired = [token for token, item in self._sessions.items() if item.expires_at < now]
        for token in expired:
            self._sessions.pop(token, None)

    def _normalize_identifier(
        self,
        *,
        login_type: AuthLoginType,
        identifier: str,
    ) -> str:
        normalized = (identifier or "").strip().lower()
        if not normalized:
            raise ValueError("账号不能为空。")
        if login_type == "phone":
            if not _PHONE_PATTERN.fullmatch(normalized):
                raise ValueError("手机号格式不正确。")
            return normalized
        if login_type == "email":
            if not _EMAIL_PATTERN.fullmatch(normalized):
                raise ValueError("邮箱格式不正确。")
            return normalized
        raise ValueError("不支持的登录类型。")

    def _ticket_key(self, *, login_type: AuthLoginType, identifier: str) -> str:
        return f"{login_type}:{identifier}"

    def _hash_code(self, code: str) -> str:
        payload = f"{self._salt}:{code}"
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def _generate_code(self) -> str:
        fixed = os.getenv("YOYOO_AUTH_FIXED_CODE")
        if fixed and re.fullmatch(r"[0-9]{6}", fixed):
            return fixed
        return f"{secrets.randbelow(1000000):06d}"

    def _make_user_id(self, identifier: str) -> str:
        pieces = _USER_TOKEN_PATTERN.findall(identifier.lower())
        safe = "_".join(pieces)[:32]
        if not safe:
            safe = secrets.token_hex(4)
        return f"u_{safe}"

    @staticmethod
    def _expose_dev_code() -> bool:
        value = os.getenv("YOYOO_AUTH_EXPOSE_DEV_CODE")
        if value is not None:
            return value.strip().lower() in {"1", "true", "yes", "on"}
        env = os.getenv("YOYOO_ENV", "dev").strip().lower()
        return env not in {"prod", "production"}
