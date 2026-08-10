import {
  agentDescriptorSchema,
  agentRunRequestSchema,
  type AgentAdapter,
  type AgentDescriptor,
  type AgentEvent,
  type AgentHealth,
  type AgentRunRequest,
} from "@/agents/contract";

interface DeterministicTestAdapterOptions {
  id?: string;
  displayName?: string;
  chunks?: string[];
  delayMs?: number;
  failAfterChunks?: number;
  cancellation?: boolean;
}

function waitForDelay(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return Promise.resolve(false);
  }

  if (delayMs === 0) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve(true);
    }, delayMs);

    const handleAbort = () => {
      clearTimeout(timeout);
      resolve(false);
    };

    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

export class DeterministicTestAdapter implements AgentAdapter {
  readonly descriptor: AgentDescriptor;
  readonly cancelledRunIds: string[] = [];
  readonly runRequests: AgentRunRequest[] = [];
  readonly #chunks: string[];
  readonly #delayMs: number;
  readonly #failAfterChunks?: number;

  constructor(options: DeterministicTestAdapterOptions = {}) {
    this.descriptor = agentDescriptorSchema.parse({
      id: options.id ?? "deterministic-test-agent",
      displayName: options.displayName ?? "Deterministic Test Agent",
      version: "1.0.0",
      capabilities: {
        streaming: true,
        cancellation: options.cancellation ?? false,
      },
    });
    this.#chunks = options.chunks ?? ["收到。"];
    this.#delayMs = options.delayMs ?? 0;
    this.#failAfterChunks = options.failAfterChunks;
  }

  async health(): Promise<AgentHealth> {
    return { status: "available" };
  }

  async *run(
    rawRequest: AgentRunRequest,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    agentRunRequestSchema.parse(rawRequest);
    this.runRequests.push(rawRequest);

    let sequence = 1;
    if (signal.aborted) {
      yield { sequence, type: "stopped" };
      return;
    }

    yield { sequence, type: "status", status: "running" };
    sequence += 1;

    const output: string[] = [];
    for (const chunk of this.#chunks) {
      const ready = await waitForDelay(this.#delayMs, signal);
      if (!ready || signal.aborted) {
        yield { sequence, type: "stopped" };
        return;
      }

      output.push(chunk);
      yield { sequence, type: "text_delta", delta: chunk };
      sequence += 1;

      if (
        this.#failAfterChunks !== undefined &&
        output.length >= this.#failAfterChunks
      ) {
        yield {
          sequence,
          type: "failed",
          error: {
            code: "DETERMINISTIC_TEST_FAILURE",
            message: "The deterministic test adapter was configured to fail",
            retriable: true,
          },
        };
        return;
      }
    }

    yield { sequence, type: "completed", text: output.join("") };
  }

  async cancel(runId: string): Promise<void> {
    this.cancelledRunIds.push(runId);
  }
}
