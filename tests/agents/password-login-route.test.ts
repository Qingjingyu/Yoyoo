import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/human-auth-runtime", () => ({
  getHumanAuthRuntime: () => ({
    config: {
      mode: "aicard",
      publicOrigin: "https://app.yoyooai.com",
      pepper: null,
    },
    service: null,
  }),
}));

import { POST } from "@/app/api/v1/auth/login/route";

describe("legacy password login route", () => {
  it("fails visibly without parsing credentials in AI Card-only mode", async () => {
    const response = await POST(new Request(
      "https://app.yoyooai.com/api/v1/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          loginHandle: "AI_100001",
          password: "must-not-be-processed",
        }),
      },
    ));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PASSWORD_LOGIN_RETIRED",
        message: "请使用 AI Card 登录。",
      },
    });
  });
});
