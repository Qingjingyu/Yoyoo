import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  HUMAN_SESSION_COOKIE,
  HumanSessionRequiredError,
  assertSameOrigin,
  createHumanSessionCookie,
  getHumanAuthConfig,
  requireHumanSession,
} from "@/server/auth/human-auth-http";

describe("human authentication HTTP boundary", () => {
  it("keeps local mode explicit and requires password mode in production", () => {
    expect(getHumanAuthConfig({ NODE_ENV: "development" })).toEqual({
      mode: "local",
      publicOrigin: null,
      pepper: null,
    });
    expect(() => getHumanAuthConfig({
      NODE_ENV: "production",
      YOYOO_PUBLIC_ORIGIN: "https://app.yoyooai.com",
    })).toThrow(
      "YOYOO_HUMAN_AUTH_MODE=password",
    );
    expect(() => getHumanAuthConfig({
      NODE_ENV: "production",
      YOYOO_HUMAN_AUTH_MODE: "password",
      YOYOO_PUBLIC_ORIGIN: "http://app.yoyooai.com",
      YOYOO_AUTH_PEPPER: randomBytes(32).toString("base64url"),
    })).toThrow("HTTPS");
  });

  it("accepts a complete production password configuration", () => {
    const pepper = randomBytes(32).toString("base64url");
    expect(getHumanAuthConfig({
      NODE_ENV: "production",
      YOYOO_HUMAN_AUTH_MODE: "password",
      YOYOO_PUBLIC_ORIGIN: "https://app.yoyooai.com",
      YOYOO_AUTH_PEPPER: pepper,
    })).toEqual({
      mode: "password",
      publicOrigin: "https://app.yoyooai.com",
      pepper: Buffer.from(pepper, "base64url"),
    });
  });

  it("resolves a valid session token and rejects missing or invalid sessions", async () => {
    const session = { principalId: "principal-id", loginHandle: "subai" };
    const service = {
      resolveSession: vi.fn().mockResolvedValueOnce(session).mockResolvedValueOnce(null),
    };
    const request = new Request("https://app.yoyooai.com/api/v1/rooms", {
      headers: { cookie: `${HUMAN_SESSION_COOKIE}=yys_valid` },
    });

    await expect(requireHumanSession(request, service)).resolves.toBe(session);
    await expect(requireHumanSession(request, service)).rejects.toBeInstanceOf(
      HumanSessionRequiredError,
    );
    await expect(
      requireHumanSession(new Request(request.url), service),
    ).rejects.toBeInstanceOf(HumanSessionRequiredError);
  });

  it("sets a secure HttpOnly session cookie without exposing it to scripts", () => {
    const cookie = createHumanSessionCookie(
      "yys_token",
      new Date("2026-09-11T00:00:00.000Z"),
      true,
    );
    expect(cookie).toContain(`${HUMAN_SESSION_COOKIE}=yys_token`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
  });

  it("rejects cross-origin browser mutations", () => {
    expect(() => assertSameOrigin(new Request("https://app.yoyooai.com/api/v1/rooms", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    }), "https://app.yoyooai.com")).toThrow("来源");

    expect(() => assertSameOrigin(new Request("https://app.yoyooai.com/api/v1/rooms", {
      method: "POST",
      headers: { origin: "https://app.yoyooai.com" },
    }), "https://app.yoyooai.com")).not.toThrow();
  });
});
