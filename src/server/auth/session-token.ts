import { createHash, randomBytes } from "node:crypto";

const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function hashOpaqueToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export function issueSessionToken(): string {
  return `yys_${randomBytes(32).toString("base64url")}`;
}

export function issueRecoveryCode(): string {
  const bytes = randomBytes(15);
  const body = Array.from(
    bytes,
    (byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length],
  ).join("");
  return `YRC-${body.slice(0, 5)}-${body.slice(5, 10)}-${body.slice(10)}`;
}
