import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  AICardSessionAuthority,
  FederatedAuthorizationRejectedError,
} from "@/server/auth/aicard-session-authority";

const config = {
  issuer: "https://id.yoyooai.test",
  clientId: "yoyoo_dev",
  redirectUri: "https://app.yoyooai.test/auth/aicard/callback",
  scopes: ["card.basic", "card.handle", "card.id", "offline_access"] as const,
};

describe("AI Card session authority", () => {
  it("encrypts refresh material and uses one deterministic key for concurrent rotation", async () => {
    const secret = randomBytes(32).toString("base64url");
    const subject = `sub_${"S".repeat(43)}`;
    const originalToken = `rt_${"O".repeat(43)}`;
    const rotatedToken = `rt_${"N".repeat(43)}`;
    const requests: Request[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Response.json({
        access_token: `at_${"A".repeat(43)}`,
        token_type: "Bearer",
        expires_in: 600,
        scope: config.scopes.join(" "),
        sub: subject,
        refresh_token: rotatedToken,
        refresh_expires_in: 2_591_400,
      });
    });
    const authority = new AICardSessionAuthority(config, secret, fetcher);
    const authorizationStateHash = Buffer.alloc(32, 7);
    const material = authority.protectRefreshToken({
      refreshToken: originalToken,
      authorizationStateHash,
      refreshExpiresAt: new Date("2026-09-11T00:00:00.000Z"),
    });

    expect(material.ciphertext.toString("utf8")).not.toContain(originalToken);
    await Promise.all([
      authority.refreshAuthorization({
        issuer: config.issuer,
        clientId: config.clientId,
        subject,
        authorizationStateHash,
        material,
        now: new Date("2026-08-12T00:05:00.000Z"),
      }),
      authority.refreshAuthorization({
        issuer: config.issuer,
        clientId: config.clientId,
        subject,
        authorizationStateHash,
        material,
        now: new Date("2026-08-12T00:05:00.000Z"),
      }),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(requests[0]?.headers.get("idempotency-key")).toBe(
      requests[1]?.headers.get("idempotency-key"),
    );
    expect(await requests[0]?.text()).toContain(
      `refresh_token=${encodeURIComponent(originalToken)}`,
    );
  });

  it("rejects refresh material bound to another authorization transaction", async () => {
    const authority = new AICardSessionAuthority(
      config,
      randomBytes(32).toString("base64url"),
      vi.fn(),
    );
    const material = authority.protectRefreshToken({
      refreshToken: `rt_${"O".repeat(43)}`,
      authorizationStateHash: Buffer.alloc(32, 1),
      refreshExpiresAt: new Date("2026-09-11T00:00:00.000Z"),
    });

    await expect(authority.refreshAuthorization({
      issuer: config.issuer,
      clientId: config.clientId,
      subject: `sub_${"S".repeat(43)}`,
      authorizationStateHash: Buffer.alloc(32, 2),
      material,
      now: new Date("2026-08-12T00:05:00.000Z"),
    })).rejects.toBeInstanceOf(FederatedAuthorizationRejectedError);
  });
});
