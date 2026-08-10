import {
  agentDescriptorSchema,
  type AgentAdapter,
} from "@/agents/contract";

export class UnknownAgentError extends Error {
  constructor(agentId: string) {
    super(`Unknown Agent: ${agentId}`);
    this.name = "UnknownAgentError";
  }
}

export class DuplicateAgentError extends Error {
  constructor(agentId: string) {
    super(`Agent is already registered: ${agentId}`);
    this.name = "DuplicateAgentError";
  }
}

export class UnsupportedAgentCapabilityError extends Error {
  constructor(agentId: string, capability: string) {
    super(`Agent ${agentId} does not support ${capability}`);
    this.name = "UnsupportedAgentCapabilityError";
  }
}

export class AgentRegistry {
  readonly #adapters = new Map<string, AgentAdapter>();

  constructor(adapters: Iterable<AgentAdapter> = []) {
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  register(adapter: AgentAdapter): void {
    const descriptor = agentDescriptorSchema.parse(adapter.descriptor);
    if (this.#adapters.has(descriptor.id)) {
      throw new DuplicateAgentError(descriptor.id);
    }

    this.#adapters.set(descriptor.id, adapter);
  }

  get(agentId: string): AgentAdapter {
    const adapter = this.#adapters.get(agentId);
    if (!adapter) {
      throw new UnknownAgentError(agentId);
    }

    return adapter;
  }

  async cancel(agentId: string, runId: string): Promise<void> {
    const adapter = this.get(agentId);
    if (!adapter.descriptor.capabilities.cancellation || !adapter.cancel) {
      throw new UnsupportedAgentCapabilityError(agentId, "cancellation");
    }

    await adapter.cancel(runId);
  }
}
