import { agentEventSchema, type AgentEvent } from "@/agents/contract";
import { AgentRegistry } from "@/agents/registry";
import { RunRepository } from "@/server/postgres/run-repository";

const terminalTypes = new Set<AgentEvent["type"]>(["completed", "failed", "stopped"]);

function interruptionEvent(sequence: number, aborted: boolean): AgentEvent {
  if (aborted) return { sequence, type: "stopped" };
  return {
    sequence,
    type: "failed",
    error: {
      code: "AGENT_RUN_ERROR",
      message: "Agent run failed",
      retriable: true,
    },
  };
}

export class RunCoordinator {
  readonly #active = new Map<
    string,
    { controller: AbortController; execution: Promise<void> }
  >();

  constructor(
    private readonly runs: RunRepository,
    private readonly registry: AgentRegistry,
  ) {}

  start(runId: string): Promise<void> {
    const current = this.#active.get(runId);
    if (current) return current.execution;

    const controller = new AbortController();
    const execution = this.#execute(runId, controller).finally(() => {
      this.#active.delete(runId);
    });
    this.#active.set(runId, { controller, execution });
    return execution;
  }

  async #execute(runId: string, controller: AbortController): Promise<void> {
    let nextSequence = 1;
    try {
      const claimed = await this.runs.claim(runId);
      if (!claimed) return;
      const context = await this.runs.getExecutionContext(runId);
      const adapter = this.registry.get(context.adapterId);
      let terminalSeen = false;

      for await (const rawEvent of adapter.run(
        {
          runId,
          conversationId: context.conversationId,
          message: context.message,
        },
        controller.signal,
      )) {
        let event = agentEventSchema.parse(rawEvent);
        if (event.sequence !== nextSequence) {
          throw new Error(
            `Agent event sequence must be ${nextSequence}, received ${event.sequence}`,
          );
        }
        if (controller.signal.aborted && event.type === "completed") {
          event = { sequence: event.sequence, type: "stopped" };
        }

        await this.runs.appendEvent(runId, event);
        nextSequence += 1;
        terminalSeen = terminalTypes.has(event.type);
        if (terminalSeen) break;
      }

      if (!terminalSeen) {
        await this.runs.appendEvent(runId, interruptionEvent(nextSequence, controller.signal.aborted));
      }
    } catch {
      const run = await this.runs.get(runId);
      if (run.status === "queued" || run.status === "running") {
        const events = await this.runs.listEvents(runId);
        await this.runs.appendEvent(
          runId,
          interruptionEvent((events.at(-1)?.sequence ?? 0) + 1, controller.signal.aborted),
        );
      }
    }
  }

  async cancel(runId: string): Promise<void> {
    const active = this.#active.get(runId);
    if (!active) {
      const run = await this.runs.get(runId);
      if (["completed", "stopped", "failed"].includes(run.status)) return;
      throw new Error(`Run ${runId} is not active in this process`);
    }

    const run = await this.runs.get(runId);
    await this.registry.cancel(run.adapterId, runId);
    active.controller.abort();
  }

  canCancel(agentId: string): boolean {
    return this.registry.get(agentId).descriptor.capabilities.cancellation;
  }

  async waitFor(runId: string, timeoutMs = 5_000): Promise<void> {
    const active = this.#active.get(runId);
    if (active) {
      await active.execution;
      return;
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const run = await this.runs.get(runId);
      if (["completed", "stopped", "failed"].includes(run.status)) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for run ${runId}`);
  }

  reconcileInterruptedRuns(): Promise<string[]> {
    return this.runs.failInterruptedRuns();
  }
}
