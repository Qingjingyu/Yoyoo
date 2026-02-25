import {
  onEvolverFailure,
  onEvolverSuccess,
  runEvolverSafely,
  shouldRunEvolverLoop,
  type EvolverGateConfig,
  type EvolverGateState,
  type EvolverLoopDecision,
} from "./evolver-gate";

export interface TickEvolverLoopInput {
  nowMs: number;
  state: EvolverGateState;
  gateConfig?: EvolverGateConfig;
  runLoop: () => Promise<unknown>;
}

export interface TickEvolverLoopResult {
  executed: boolean;
  ok: boolean;
  error: string | null;
  decision: EvolverLoopDecision;
  state: EvolverGateState;
}

export async function tickEvolverLoop(
  input: TickEvolverLoopInput,
): Promise<TickEvolverLoopResult> {
  const decision = shouldRunEvolverLoop(input.nowMs, input.state, input.gateConfig);
  if (!decision.allow) {
    return {
      executed: false,
      ok: true,
      error: null,
      decision,
      state: input.state,
    };
  }

  const runResult = await runEvolverSafely(input.runLoop);
  if (runResult.ok) {
    return {
      executed: true,
      ok: true,
      error: null,
      decision,
      state: onEvolverSuccess(input.nowMs, input.state),
    };
  }

  const failed = onEvolverFailure(input.nowMs, input.state, input.gateConfig);
  return {
    executed: true,
    ok: false,
    error: runResult.error,
    decision,
    state: failed.state,
  };
}

