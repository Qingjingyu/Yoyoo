import { describe, expect, it } from "vitest";
import {
  defaultEvolverGateState,
  onEvolverFailure,
  onEvolverSuccess,
  runEvolverSafely,
  shouldRunEvolverLoop,
} from "../src/evolver-gate";

describe("p0 evolver gate", () => {
  it("blocks loop when disabled", () => {
    const state = defaultEvolverGateState();
    const decision = shouldRunEvolverLoop(1000, state, {
      enabled: false,
    });

    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("disabled");
  });

  it("opens circuit after continuous failures", () => {
    const now = 1_000;
    const state = defaultEvolverGateState();

    const first = onEvolverFailure(now, state, {
      failureThreshold: 3,
      baseBackoffMs: 200,
      maxBackoffMs: 2_000,
      circuitOpenMs: 10_000,
    });
    const second = onEvolverFailure(now + 300, first.state, {
      failureThreshold: 3,
      baseBackoffMs: 200,
      maxBackoffMs: 2_000,
      circuitOpenMs: 10_000,
    });
    const third = onEvolverFailure(now + 700, second.state, {
      failureThreshold: 3,
      baseBackoffMs: 200,
      maxBackoffMs: 2_000,
      circuitOpenMs: 10_000,
    });

    expect(first.backoffMs).toBe(200);
    expect(second.backoffMs).toBe(400);
    expect(third.circuitOpened).toBe(true);

    const blocked = shouldRunEvolverLoop(now + 800, third.state, {
      enabled: true,
    });
    expect(blocked.allow).toBe(false);
    expect(blocked.reason).toBe("circuit-open");
  });

  it("resets failures on success", () => {
    const failed = onEvolverFailure(2000, defaultEvolverGateState(), {
      failureThreshold: 3,
      baseBackoffMs: 200,
      maxBackoffMs: 2_000,
      circuitOpenMs: 10_000,
    });
    const recovered = onEvolverSuccess(2300, failed.state);

    expect(recovered.consecutiveFailures).toBe(0);
    expect(recovered.circuitOpenUntil).toBeNull();
    expect(recovered.nextAllowedAt).toBeNull();
  });

  it("shields main service when evolver throws", async () => {
    const out = await runEvolverSafely(async () => {
      throw new Error("evolver crashed");
    });

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toContain("evolver crashed");
    }
  });
});
