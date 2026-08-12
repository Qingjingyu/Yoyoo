import { scrypt as scryptCallback, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const HANDLE_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;
const SCRYPT_KEY_LENGTH = 64;

export interface PasswordCredential {
  algorithm: "scrypt-v1";
  hash: Buffer;
  salt: Buffer;
}

export function normalizeLoginHandle(value: string): string {
  const withoutMention = value.startsWith("@") ? value.slice(1) : value;
  if (withoutMention !== withoutMention.trim()) {
    throw new Error("登录账号不能包含首尾空格。");
  }
  const normalized = withoutMention.toLowerCase();
  if (!HANDLE_PATTERN.test(normalized)) {
    throw new Error("登录账号必须为 3 至 64 位字母、数字、点、下划线或连字符。");
  }
  return normalized;
}

function validatePassword(password: string): void {
  if (
    password.length < PASSWORD_MIN_LENGTH
    || password.length > PASSWORD_MAX_LENGTH
    || password !== password.trim()
  ) {
    throw new Error("密码必须为 12 至 128 个字符，且不能包含首尾空格。");
  }
}

async function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return (await scrypt(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
}

export async function hashPassword(password: string): Promise<PasswordCredential> {
  validatePassword(password);
  const salt = randomBytes(16);
  return {
    algorithm: "scrypt-v1",
    hash: await derivePassword(password, salt),
    salt,
  };
}

export async function verifyPassword(
  password: string,
  credential: PasswordCredential,
): Promise<boolean> {
  if (credential.algorithm !== "scrypt-v1") return false;
  try {
    validatePassword(password);
  } catch {
    return false;
  }
  const candidate = await derivePassword(password, credential.salt);
  return candidate.length === credential.hash.length
    && timingSafeEqual(candidate, credential.hash);
}
