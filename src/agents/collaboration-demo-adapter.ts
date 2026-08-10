import {
  agentDescriptorSchema,
  agentRunRequestSchema,
  type AgentAdapter,
  type AgentDescriptor,
  type AgentEvent,
  type AgentHealth,
  type AgentRunRequest,
} from "@/agents/contract";

type DemoRole = "planner" | "builder" | "reviewer";

interface CollaborationDemoAdapterOptions {
  id: string;
  displayName: string;
  role: DemoRole;
  delegatePrincipalId?: string;
  delayMs?: number;
  failurePattern?: string;
}

function pause(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class CollaborationDemoAdapter implements AgentAdapter {
  readonly descriptor: AgentDescriptor;
  readonly #role: DemoRole;
  readonly #delegatePrincipalId?: string;
  readonly #delayMs: number;
  readonly #failurePattern?: string;

  constructor(options: CollaborationDemoAdapterOptions) {
    this.#role = options.role;
    this.#delegatePrincipalId = options.delegatePrincipalId;
    this.#delayMs = options.delayMs ?? 80;
    this.#failurePattern = options.failurePattern?.trim() || undefined;
    this.descriptor = agentDescriptorSchema.parse({
      id: options.id,
      displayName: options.displayName,
      version: "local-demo-v1",
      capabilities: {
        streaming: true,
        cancellation: true,
        delegation: options.role === "planner",
        artifacts: options.role === "builder",
        attachments: true,
      },
    });
  }

  async health(): Promise<AgentHealth> {
    return { status: "available", message: "Local development Agent" };
  }

  async *run(
    rawRequest: AgentRunRequest,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const request = agentRunRequestSchema.parse(rawRequest);
    if (!("roomId" in request)) {
      yield {
        sequence: 1,
        type: "failed",
        error: {
          code: "ROOM_CONTEXT_REQUIRED",
          message: "This Agent requires room context",
          retriable: false,
        },
      };
      return;
    }
    if (signal.aborted) {
      yield { sequence: 1, type: "stopped" };
      return;
    }

    let sequence = 1;
    yield { sequence, type: "status", status: "running" };
    sequence += 1;
    const ready = await pause(this.#role === "reviewer" ? 900 : this.#delayMs, signal);
    if (!ready || signal.aborted) {
      yield { sequence, type: "stopped" };
      return;
    }

    if (this.#role === "planner") {
      if (!this.#delegatePrincipalId) {
        yield {
          sequence,
          type: "failed",
          error: {
            code: "DELEGATE_NOT_CONFIGURED",
            message: "Planner delegate is not configured",
            retriable: false,
          },
        };
        return;
      }
      yield {
        sequence,
        type: "delegation",
        delegatePrincipalId: this.#delegatePrincipalId,
        objective: `请把以下目标整理成最终 Markdown 交付物：${request.message}`,
        idempotencyKey: "local-builder-delegation",
      };
      sequence += 1;
      const text = "方案已经拆解，并委托 Builder 生成最终交付物。";
      yield { sequence, type: "text_delta", delta: text };
      sequence += 1;
      yield { sequence, type: "completed", text };
      return;
    }

    if (this.#role === "builder") {
      const content = [
        "# Yoyoo 协作交付物",
        "",
        "## 目标",
        request.message,
        "",
        "## 结果",
        "已完成多人 + 多 AI 协作任务的本地可验证交付。",
      ].join("\n");
      yield {
        sequence,
        type: "artifact",
        artifact: {
          type: "markdown",
          title: "Yoyoo 协作交付物",
          content,
          metadata: { source: "local-demo", formatVersion: 1 },
        },
        idempotencyKey: "local-markdown-artifact",
      };
      sequence += 1;
      yield { sequence, type: "completed", text: "最终交付物已经生成。" };
      return;
    }

    if (this.#failurePattern && request.message.includes(this.#failurePattern)) {
      yield {
        sequence,
        type: "failed",
        error: {
          code: "LOCAL_REVIEW_FAILURE",
          message: "Reviewer 暂时无法完成审阅。",
          retriable: true,
        },
      };
      return;
    }

    const text = "审阅完成：任务目标、委托关系和交付物结构一致。";
    yield { sequence, type: "text_delta", delta: text };
    sequence += 1;
    yield { sequence, type: "completed", text };
  }

  async cancel(): Promise<void> {}
}
