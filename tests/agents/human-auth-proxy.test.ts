import { describe, expect, it, vi } from "vitest";

import {
  authorizeHumanRequest,
  isPublicHumanPath,
} from "@/server/auth/human-auth-proxy";

describe("human authentication proxy policy", () => {
  const config = {
    mode: "password" as const,
    publicOrigin: "https://app.yoyooai.com",
    pepper: Buffer.alloc(32),
  };

  it("exposes the legacy password endpoint only in rollback mode", () => {
    expect(isPublicHumanPath("/login", "aicard")).toBe(true);
    expect(isPublicHumanPath("/api/v1/auth/login", "aicard")).toBe(false);
    expect(isPublicHumanPath("/api/v1/auth/login", "password")).toBe(true);
    expect(isPublicHumanPath("/api/v1/auth/aicard/start", "aicard")).toBe(true);
    expect(isPublicHumanPath("/auth/aicard/callback", "aicard")).toBe(true);
    expect(isPublicHumanPath("/api/health", "aicard")).toBe(true);
    expect(isPublicHumanPath("/_next/static/app.js", "aicard")).toBe(true);
    expect(isPublicHumanPath("/api/v1/agent-gateway/heartbeat", "aicard")).toBe(true);
    expect(isPublicHumanPath("/conversation", "aicard")).toBe(false);
    expect(isPublicHumanPath("/api/v1/attachments/private/content", "aicard")).toBe(false);
  });

  it("allows local mode without consulting the password service", async () => {
    const service = { resolveSession: vi.fn() };
    await expect(authorizeHumanRequest(
      new Request("http://127.0.0.1:4173/conversation"),
      { mode: "local", publicOrigin: null, pepper: null },
      service,
    )).resolves.toEqual({ kind: "allowed", session: null });
    expect(service.resolveSession).not.toHaveBeenCalled();
  });

  it("redirects anonymous pages and rejects anonymous private APIs", async () => {
    const service = { resolveSession: vi.fn().mockResolvedValue(null) };
    await expect(authorizeHumanRequest(
      new Request("https://app.yoyooai.com/conversation?room=one"),
      config,
      service,
    )).resolves.toEqual({
      kind: "redirect",
      location: "/login?next=%2Fconversation%3Froom%3Done",
    });
    await expect(authorizeHumanRequest(
      new Request("https://app.yoyooai.com/api/v1/rooms"),
      config,
      service,
    )).resolves.toEqual({ kind: "unauthorized" });
  });

  it("protects the removed password endpoint in AI Card-only mode", async () => {
    const service = { resolveSession: vi.fn().mockResolvedValue(null) };
    await expect(authorizeHumanRequest(
      new Request("https://app.yoyooai.com/api/v1/auth/login", { method: "POST" }),
      { mode: "aicard", publicOrigin: "https://app.yoyooai.com", pepper: null },
      service,
    )).resolves.toEqual({ kind: "unauthorized" });
  });

  it("allows a database-validated session and rejects cross-origin mutations", async () => {
    const session = { principalId: "principal-id" };
    const service = { resolveSession: vi.fn().mockResolvedValue(session) };
    const cookie = { cookie: "yoyoo_session=yys_valid" };
    await expect(authorizeHumanRequest(
      new Request("https://app.yoyooai.com/conversation", { headers: cookie }),
      config,
      service,
    )).resolves.toEqual({ kind: "allowed", session });
    await expect(authorizeHumanRequest(
      new Request("https://app.yoyooai.com/api/v1/rooms", {
        method: "POST",
        headers: { ...cookie, origin: "https://attacker.example" },
      }),
      config,
      service,
    )).resolves.toEqual({ kind: "forbidden-origin" });
  });
});
