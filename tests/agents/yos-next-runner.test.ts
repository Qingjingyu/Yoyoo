/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";

import { loadYosEnvironment } from "../../scripts/run-yos-next.mts";

describe("YOS Next runner", () => {
  it("loads the external YOS env before selecting the YOS adapter", () => {
    const environment: Record<string, string | undefined> = {};
    const loadEnvFile = vi.fn((path: string) => {
      environment.WEB_CONSOLE_PORT = "3457";
      environment.YOS_WEB_PASSWORD = "fixture-secret";
      expect(path).toBe("/private/yos.env");
    });

    const result = loadYosEnvironment({
      envFile: "/private/yos.env",
      environment,
      loadEnvFile,
    });

    expect(loadEnvFile).toHaveBeenCalledOnce();
    expect(result).toEqual({ envFile: "/private/yos.env" });
    expect(environment).toMatchObject({
      YOYOO_AGENT_ADAPTER: "yos-web-console",
      WEB_CONSOLE_PORT: "3457",
      YOS_WEB_PASSWORD: "fixture-secret",
    });
  });
});
