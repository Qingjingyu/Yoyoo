import { agentEventSchema, type AgentEvent } from "@/agents/contract";
import {
  AgentRegistry,
  UnsupportedAgentCapabilityError,
} from "@/agents/registry";
import type { CollaborationRunRecord } from "@/domain/collaboration";
import { ArtifactRepository } from "@/server/postgres/artifact-repository";
import { AttachmentRepository } from "@/server/postgres/attachment-repository";
import { CollaborationRunRepository } from "@/server/postgres/collaboration-run-repository";
import { DelegationRepository } from "@/server/postgres/delegation-repository";
import { PrincipalRepository } from "@/server/postgres/principal-repository";

const terminalTypes = new Set<AgentEvent["type"]>(["completed", "failed", "stopped"]);
const ATTACHMENT_GRANT_LIFETIME_MS = 10 * 60 * 1000;

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

export class CollaborationRunCoordinator {
  readonly #active = new Map<
    string,
    { controller: AbortController; execution: Promise<void> }
  >();

  constructor(
    private readonly runs: CollaborationRunRepository,
    private readonly registry: AgentRegistry,
    private readonly principals: PrincipalRepository,
    private readonly delegations: DelegationRepository,
    private readonly artifacts: ArtifactRepository,
    private readonly attachments?: AttachmentRepository,
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
    let persistedSequence = 0;
    let adapterSequence = 1;
    try {
      const claimed = await this.runs.claim(runId);
      if (!claimed) return;
      const context = await this.runs.getExecutionContext(runId);
      const adapter = this.registry.get(context.run.adapterId);
      const persistedEvents = await this.runs.listEvents(runId);
      persistedSequence = persistedEvents.at(-1)?.sequence ?? 0;
      const roomRequest = "workspaceId" in context.request ? context.request : null;
      const requestAttachments = roomRequest?.attachments ?? [];
      if (requestAttachments.length > 0) {
        if (!adapter.descriptor.capabilities.attachments || !this.attachments) {
          const failed = await this.runs.appendEvent(runId, {
            sequence: persistedSequence + 1,
            type: "failed",
            error: {
              code: "ATTACHMENTS_NOT_SUPPORTED",
              message: "当前 Agent 无法读取附件",
              retriable: false,
            },
          });
          await this.#settleDelegation(failed);
          return;
        }
        const expiresAt = new Date(Date.now() + ATTACHMENT_GRANT_LIFETIME_MS);
        for (const attachment of requestAttachments) {
          await this.attachments.createAccessGrant({
            workspaceId: roomRequest!.workspaceId,
            roomId: context.run.roomId,
            attachmentId: attachment.attachmentId,
            runId,
            principalId: context.run.targetAgentPrincipalId,
            expiresAt,
          });
        }
      }
      let terminalSeen = false;

      for await (const rawEvent of adapter.run(context.request, controller.signal)) {
        const parsedEvent = agentEventSchema.parse(rawEvent);
        if (parsedEvent.sequence !== adapterSequence) {
          throw new Error(
            `Agent event sequence must be ${adapterSequence}, received ${parsedEvent.sequence}`,
          );
        }
        let event = agentEventSchema.parse({
          ...parsedEvent,
          sequence: persistedSequence + 1,
        });
        if (controller.signal.aborted && event.type === "completed") {
          event = { sequence: event.sequence, type: "stopped" };
        }
        if (event.type === "delegation" && !adapter.descriptor.capabilities.delegation) {
          throw new UnsupportedAgentCapabilityError(adapter.descriptor.id, "delegation");
        }
        if (event.type === "artifact" && !adapter.descriptor.capabilities.artifacts) {
          throw new UnsupportedAgentCapabilityError(adapter.descriptor.id, "artifacts");
        }

        await this.runs.appendEvent(runId, event);
        persistedSequence += 1;
        adapterSequence += 1;

        if (event.type === "delegation") {
          const binding = await this.principals.getAgentBinding(event.delegatePrincipalId);
          this.registry.get(binding.adapterId);
          const child = await this.runs.createDelegatedRun({
            parentRunId: runId,
            delegatePrincipalId: event.delegatePrincipalId,
            adapterId: binding.adapterId,
            idempotencyKey: event.idempotencyKey,
          });
          await this.delegations.create({
            roomId: context.run.roomId,
            delegatorPrincipalId: context.run.targetAgentPrincipalId,
            delegatePrincipalId: event.delegatePrincipalId,
            parentRunId: runId,
            childRunId: child.run.id,
            objective: event.objective,
            status: "running",
            idempotencyKey: `${runId}:${event.idempotencyKey}`,
          });
          if (!child.duplicate) void this.start(child.run.id);
        } else if (event.type === "artifact") {
          await this.artifacts.create({
            roomId: context.run.roomId,
            producerPrincipalId: context.run.targetAgentPrincipalId,
            sourceRunId: runId,
            type: event.artifact.type,
            title: event.artifact.title,
            content: event.artifact.content,
            metadata: event.artifact.metadata,
            idempotencyKey: `${runId}:${event.idempotencyKey}`,
          });
        }

        terminalSeen = terminalTypes.has(event.type);
        if (terminalSeen) {
          await this.#settleDelegation(await this.runs.get(runId));
          break;
        }
      }

      if (!terminalSeen) {
        const run = await this.runs.appendEvent(
          runId,
          interruptionEvent(persistedSequence + 1, controller.signal.aborted),
        );
        await this.#settleDelegation(run);
      }
    } catch {
      const run = await this.runs.get(runId);
      if (["queued", "running", "waiting"].includes(run.status)) {
        const events = await this.runs.listEvents(runId);
        const failed = await this.runs.appendEvent(
          runId,
          interruptionEvent(
            (events.at(-1)?.sequence ?? 0) + 1,
            controller.signal.aborted,
          ),
        );
        await this.#settleDelegation(failed);
      }
    }
  }

  async #settleDelegation(run: CollaborationRunRecord): Promise<void> {
    if (!(["completed", "stopped", "failed"] as const).includes(
      run.status as "completed" | "stopped" | "failed",
    )) return;
    await this.delegations.settleByChildRun({
      childRunId: run.id,
      status: run.status as "completed" | "stopped" | "failed",
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
    });
  }

  async cancel(runId: string): Promise<void> {
    const run = await this.runs.get(runId);
    if (["completed", "stopped", "failed"].includes(run.status)) {
      throw new Error(`Collaboration run ${runId} is already terminal`);
    }
    const active = this.#active.get(runId);
    if (!active) {
      throw new Error(`Run ${runId} is not active in this process`);
    }
    active.controller.abort();
    await this.registry.cancel(run.adapterId, runId);
  }

  canCancel(adapterId: string): boolean {
    return this.registry.get(adapterId).descriptor.capabilities.cancellation;
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

  async shutdown(): Promise<void> {
    const active = [...this.#active.values()];
    for (const { controller } of active) controller.abort();
    await Promise.allSettled(active.map(({ execution }) => execution));
  }

  reconcileInterruptedRuns(excludedAdapterIds: string[] = []): Promise<string[]> {
    return this.runs.failInterruptedRuns(excludedAdapterIds);
  }
}
