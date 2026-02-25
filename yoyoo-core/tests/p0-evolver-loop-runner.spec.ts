import { describe, expect, it, vi } from "vitest";
import { defaultEvolverGateState } from "../src/evolver-gate";
import { tickEvolverLoop } from "../src/evolver-loop-runner";

describe("p0 evolver loop runner", () => {
  it("skips execution when gate is disabled", async () => {
    const run = vi.fn(async () => {});
    const out = await tickEvolverLoop({
      nowMs: 1000,
      state: defaultEvolverGateState(),
      gateConfig: { enabled: false },
      runLoop: run,
    });

    expect(out.executed).toBe(false);
    expect(out.decision.reason).toBe("disabled");
    expect(run).not.toHaveBeenCalled();
  });

  it("executes once and marks success state", async () => {
    const run = vi.fn(async () => ({ summary: "ok" }));
    const out = await tickEvolverLoop({
      nowMs: 2000,
      state: defaultEvolverGateState(),
      gateConfig: { enabled: true, failureThreshold: 3 },
      runLoop: run,
    });

    expect(out.executed).toBe(true);
    expect(out.ok).toBe(true);
    expect(out.state.consecutiveFailures).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("opens circuit after repeated failures", async () => {
    const run = vi.fn(async () => {
      throw new Error("loop failed");
    });
    const cfg = {
      enabled: true,
      failureThreshold: 2,
      baseBackoffMs: 100,
      maxBackoffMs: 1000,
      circuitOpenMs: 5000,
      minLoopIntervalMs: 0,
    };

    const first = await tickEvolverLoop({
      nowMs: 3000,
      state: defaultEvolverGateState(),
      gateConfig: cfg,
      runLoop: run,
    });
    const second = await tickEvolverLoop({
      nowMs: 3200,
      state: first.state,
      gateConfig: cfg,
      runLoop: run,
    });
    const third = await tickEvolverLoop({
      nowMs: 3300,
      state: second.state,
      gateConfig: cfg,
      runLoop: run,
    });

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(second.state.circuitOpenUntil).not.toBeNull();
    expect(third.executed).toBe(false);
    expect(third.decision.reason).toBe("circuit-open");
  });

  it("never throws to caller when loop task crashes", async () => {
    const out = await tickEvolverLoop({
      nowMs: 4000,
      state: defaultEvolverGateState(),
      gateConfig: { enabled: true },
      runLoop: async () => {
        throw new Error("boom");
      },
    });

    expect(out.ok).toBe(false);
    expect(out.error).toContain("boom");
  });
});
