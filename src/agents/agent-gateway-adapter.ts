import { z } from "zod";

import type {
  AgentAdapter,
  AgentEvent,
  AgentRunRequest,
} from "@/agents/contract";
import type { AgentGatewayJobRecord } from "@/domain/collaboration";

const gatewayResultSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("completed"),
      text: z.string().max(1_000_000),
      attachmentIds: z.array(z.string().uuid()).max(10).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("failed"),
      error: z
        .object({
          code: z.string().trim().min(1).max(80),
          message: z.string().trim().min(1).max(240),
          retriable: z.boolean(),
        })
        .strict(),
    })
    .strict(),
]);

export interface AgentGatewayJobStore {
  enqueueJob(input: {
    runId: string;
    request: Record<string, unknown>;
  }): Promise<AgentGatewayJobRecord>;
  getJobByRunId(runId: string): Promise<AgentGatewayJobRecord | null>;
}

export interface AgentGatewayAdapterOptions {
  pollIntervalMs?: number;
  responseTimeoutMs?: number;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(done, ms);
    function done() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export class AgentGatewayAdapter implements AgentAdapter {
  readonly descriptor = {
    id: "yoyoo-agent-gateway",
    displayName: "Yoyoo Agent Gateway",
    version: "0.8.0",
    capabilities: {
      streaming: false,
      cancellation: false,
      delegation: false,
      artifacts: false,
      attachments: true,
    },
  } as const;

  readonly #pollIntervalMs: number;
  readonly #responseTimeoutMs: number;

  constructor(
    private readonly store: AgentGatewayJobStore,
    options: AgentGatewayAdapterOptions = {},
  ) {
    this.#pollIntervalMs = Math.max(options.pollIntervalMs ?? 250, 1);
    this.#responseTimeoutMs = Math.max(options.responseTimeoutMs ?? 120_000, 1);
  }

  async health(): Promise<{ status: "available" }> {
    return { status: "available" };
  }

  async *run(
    request: AgentRunRequest,
    signal: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    await this.store.enqueueJob({ runId: request.runId, request });
    yield { sequence: 1, type: "status", status: "running" };

    const deadline = Date.now() + this.#responseTimeoutMs;
    while (true) {
      if (signal.aborted) {
        yield { sequence: 2, type: "stopped" };
        return;
      }

      const job = await this.store.getJobByRunId(request.runId);
      if (job?.status === "completed" || job?.status === "failed") {
        const result = gatewayResultSchema.safeParse(job.result);
        if (!result.success) {
          yield {
            sequence: 2,
            type: "failed",
            error: {
              code: "INVALID_GATEWAY_RESULT",
              message: "Agent returned an invalid result",
              retriable: false,
            },
          };
          return;
        }
        if (result.data.type === "completed") {
          yield {
            sequence: 2,
            type: "completed",
            text: result.data.text,
            ...(result.data.attachmentIds
              ? { attachmentIds: result.data.attachmentIds }
              : {}),
          };
        } else {
          yield { sequence: 2, type: "failed", error: result.data.error };
        }
        return;
      }

      if (Date.now() >= deadline) {
        yield {
          sequence: 2,
          type: "failed",
          error: {
            code: "GATEWAY_TIMEOUT",
            message: "Agent did not return a result before the timeout",
            retriable: true,
          },
        };
        return;
      }
      await wait(this.#pollIntervalMs, signal);
    }
  }
}
