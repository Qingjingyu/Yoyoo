import { describe, expect, it } from "vitest";

import {
  hashOpaqueToken,
  issueRecoveryCode,
  issueSessionToken,
} from "@/server/auth/session-token";

describe("opaque authentication tokens", () => {
  it("issues prefixed random session tokens and stores fixed-length hashes", () => {
    const first = issueSessionToken();
    const second = issueSessionToken();

    expect(first).toMatch(/^yys_[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
    expect(hashOpaqueToken(first)).toHaveLength(32);
    expect(hashOpaqueToken(first)).not.toEqual(Buffer.from(first));
  });

  it("issues a human-readable one-time recovery code", () => {
    const recovery = issueRecoveryCode();

    expect(recovery).toMatch(/^YRC-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(hashOpaqueToken(recovery)).toHaveLength(32);
  });
});
