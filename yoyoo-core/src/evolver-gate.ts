export interface EvolverGateConfig {
  enabled?: boolean;
  minLoopIntervalMs?: number;
  failureThreshold?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  circuitOpenMs?: number;
}

export interface EvolverGateState {
  lastAttemptAt: number | null;
  consecutiveFailures: number;
  nextAllowedAt: number | null;
  circuitOpenUntil: number | null;
}

export interface EvolverLoopDecision {
  allow: boolean;
  reason: "ready" | "disabled" | "throttled" | "circuit-open";
  waitMs: number;
}

export interface EvolverFailureResult {
  state: EvolverGateState;
  backoffMs: number;
  circuitOpened: boolean;
}

const DEFAULT_CONFIG: Required<EvolverGateConfig> = {
  enabled: true,
  minLoopIntervalMs: 0,
  failureThreshold: 3,
  baseBackoffMs: 1_000,
  maxBackoffMs: 30_000,
  circuitOpenMs: 60_000,
};

function withDefaults(config?: EvolverGateConfig): Required<EvolverGateConfig> {
  return {
    ...DEFAULT_CONFIG,
    ...config,
  };
}

export function defaultEvolverGateState(): EvolverGateState {
  return {
    lastAttemptAt: null,
    consecutiveFailures: 0,
    nextAllowedAt: null,
    circuitOpenUntil: null,
  };
}

export function shouldRunEvolverLoop(
  nowMs: number,
  state: EvolverGateState,
  config?: EvolverGateConfig,
): EvolverLoopDecision {
  const finalConfig = withDefaults(config);
  if (!finalConfig.enabled) {
    return {
      allow: false,
      reason: "disabled",
      waitMs: 0,
    };
  }

  if (state.circuitOpenUntil && nowMs < state.circuitOpenUntil) {
    return {
      allow: false,
      reason: "circuit-open",
      waitMs: Math.max(state.circuitOpenUntil - nowMs, 0),
    };
  }

  const intervalBlocked =
    state.lastAttemptAt !== null &&
    finalConfig.minLoopIntervalMs > 0 &&
    nowMs - state.lastAttemptAt < finalConfig.minLoopIntervalMs;
  if (intervalBlocked) {
    return {
      allow: false,
      reason: "throttled",
      waitMs: finalConfig.minLoopIntervalMs - (nowMs - (state.lastAttemptAt ?? nowMs)),
    };
  }

  if (state.nextAllowedAt !== null && nowMs < state.nextAllowedAt) {
    return {
      allow: false,
      reason: "throttled",
      waitMs: Math.max(state.nextAllowedAt - nowMs, 0),
    };
  }

  return {
    allow: true,
    reason: "ready",
    waitMs: 0,
  };
}

export function onEvolverFailure(
  nowMs: number,
  state: EvolverGateState,
  config?: EvolverGateConfig,
): EvolverFailureResult {
  const finalConfig = withDefaults(config);
  const consecutiveFailures = state.consecutiveFailures + 1;
  const backoffMs = Math.min(
    finalConfig.baseBackoffMs * 2 ** (consecutiveFailures - 1),
    finalConfig.maxBackoffMs,
  );

  const circuitOpened = consecutiveFailures >= finalConfig.failureThreshold;
  const circuitOpenUntil = circuitOpened ? nowMs + finalConfig.circuitOpenMs : null;

  return {
    backoffMs,
    circuitOpened,
    state: {
      lastAttemptAt: nowMs,
      consecutiveFailures,
      nextAllowedAt: nowMs + backoffMs,
      circuitOpenUntil,
    },
  };
}

export function onEvolverSuccess(
  nowMs: number,
  state: EvolverGateState,
): EvolverGateState {
  return {
    lastAttemptAt: nowMs,
    consecutiveFailures: 0,
    nextAllowedAt: null,
    circuitOpenUntil: null,
  };
}

export async function runEvolverSafely<T>(
  runner: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const value = await runner();
    return {
      ok: true,
      value,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: message,
    };
  }
}

