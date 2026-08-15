import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/v1/agent-admissions/instructions/route";

describe("Agent admission public instructions", () => {
  it("publishes a secret-free stable onboarding contract", async () => {
    const response = GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(body).toContain("Yoyoo Agent Admission Protocol v1");
    expect(body).toContain("--identity-credential");
    expect(body).not.toMatch(/at_[A-Za-z0-9_-]{43}/);
  });
});
