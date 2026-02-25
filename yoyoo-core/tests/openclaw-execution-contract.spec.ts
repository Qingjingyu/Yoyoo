import { describe, expect, it } from "vitest";
import {
  getOpenClawExecutionContract,
  isValidPluginManifest,
} from "../src/openclaw-execution-contract";

describe("openclaw execution contract", () => {
  it("pins execution surfaces and command boundaries", () => {
    const contract = getOpenClawExecutionContract();
    expect(contract.surfaces).toEqual([
      "gateway",
      "channels",
      "skills",
      "hooks",
      "plugins",
    ]);
    expect(contract.gateway.runCommand).toBe("openclaw gateway");
    expect(contract.channels.statusCommand).toBe("openclaw channels status");
    expect(contract.plugins.manifestFile).toBe("openclaw.plugin.json");
  });

  it("keeps documented hook discovery precedence", () => {
    const contract = getOpenClawExecutionContract();
    expect(contract.hooks.discoveryOrder).toEqual({
      workspace: "<workspace>/hooks",
      managed: "~/.openclaw/hooks",
      bundled: "<openclaw>/dist/hooks/bundled",
    });
  });

  it("accepts only plugin manifests with id + configSchema", () => {
    expect(
      isValidPluginManifest({
        id: "feishu",
        configSchema: { type: "object", properties: {} },
      }),
    ).toBe(true);

    expect(
      isValidPluginManifest({
        id: "feishu",
      }),
    ).toBe(false);

    expect(
      isValidPluginManifest({
        configSchema: { type: "object" },
      }),
    ).toBe(false);
  });
});

