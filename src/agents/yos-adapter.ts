import { z } from "zod";

import {
  agentDescriptorSchema,
  agentRunRequestSchema,
  type AgentAdapter,
  type AgentDescriptor,
  type AgentEvent,
  type AgentHealth,
  type AgentRunRequest,
} from "./contract.ts";
import { formatRoomConversation } from "./room-context.ts";

const authSchema = z
  .object({
    required: z.boolean(),
    authenticated: z.boolean(),
  })
  .passthrough();

const healthSchema = z.object({ status: z.string() }).passthrough();
const statusSchema = z.object({ state: z.string() }).passthrough();
const messageSchema = z
  .object({
    id: z.number().int().nonnegative(),
    direction: z.enum(["in", "out"]),
    content: z.string(),
  })
  .passthrough();
const messagesSchema = z.array(messageSchema);

interface YosWebConsoleAdapterOptions {
  baseUrl: string;
  password?: string;
  pollIntervalMs?: number;
  responseTimeoutMs?: number;
}

class YosAdapterFailure extends Error {
  readonly code: string;
  readonly retriable: boolean;

  constructor(
    code: string,
    message: string,
    retriable: boolean,
  ) {
    super(message);
    this.name = "YosAdapterFailure";
    this.code = code;
    this.retriable = retriable;
  }
}

function normalizedBaseUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("YOS Web Console URL must be an HTTP(S) URL without credentials");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function boundedNumber(value: number | undefined, fallback: number, minimum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) throw new Error("YOS timing options must be finite numbers");
  return Math.max(minimum, Math.floor(value));
}

function wait(delayMs: number, signal: AbortSignal): Promise<boolean> {
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

function failureEvent(sequence: number, error: unknown): AgentEvent {
  const failure = error instanceof YosAdapterFailure
    ? error
    : new YosAdapterFailure("YOS_CONNECTION_FAILED", "YOS Web Console is unavailable", true);
  return {
    sequence,
    type: "failed",
    error: {
      code: failure.code,
      message: failure.message,
      retriable: failure.retriable,
    },
  };
}

export class YosWebConsoleAdapter implements AgentAdapter {
  readonly descriptor: AgentDescriptor = agentDescriptorSchema.parse({
    id: "yos-web-console",
    displayName: "YOS",
    version: "web-console-v1",
    capabilities: {
      streaming: false,
      cancellation: false,
    },
  });

  readonly #baseUrl: string;
  readonly #password?: string;
  readonly #pollIntervalMs: number;
  readonly #responseTimeoutMs: number;
  #cookie?: string;

  constructor(options: YosWebConsoleAdapterOptions) {
    this.#baseUrl = normalizedBaseUrl(options.baseUrl);
    this.#password = options.password;
    this.#pollIntervalMs = boundedNumber(options.pollIntervalMs, 500, 1);
    this.#responseTimeoutMs = boundedNumber(options.responseTimeoutMs, 180_000, 1);
  }

  async health(signal?: AbortSignal): Promise<AgentHealth> {
    const requestSignal = signal ?? new AbortController().signal;
    try {
      const health = healthSchema.parse(await this.#json("/api/health", { signal: requestSignal }));
      if (health.status !== "ok") {
        return { status: "unavailable", message: "YOS Web Console health check failed" };
      }
      await this.#authenticate(requestSignal);
      const status = statusSchema.parse(await this.#json("/api/status", { signal: requestSignal }));
      if (["idle", "busy", "working", "running"].includes(status.state)) {
        return { status: "available" };
      }
      if (["offline", "stopped"].includes(status.state)) {
        return { status: "unavailable", message: `YOS Agent is ${status.state}` };
      }
      return { status: "degraded", message: "YOS Agent status is not confirmed" };
    } catch (error) {
      const message = error instanceof YosAdapterFailure
        ? error.message
        : "YOS Web Console is unavailable";
      return { status: "unavailable", message };
    }
  }

  async *run(rawRequest: AgentRunRequest, signal: AbortSignal): AsyncGenerator<AgentEvent> {
    const request = agentRunRequestSchema.parse(rawRequest);
    if (signal.aborted) {
      yield { sequence: 1, type: "stopped" };
      return;
    }

    let sequence = 1;
    try {
      await this.#authenticate(signal);
      const recent = messagesSchema.parse(
        await this.#json("/api/conversations/recent?limit=1", { signal }),
      );
      let cursor = recent.reduce((maximum, message) => Math.max(maximum, message.id), 0);
      let priorRequestPending = recent.at(-1)?.direction === "in";

      if (priorRequestPending) {
        const settleDeadline = Date.now() + this.#responseTimeoutMs;
        while (priorRequestPending && Date.now() < settleDeadline) {
          if (signal.aborted) {
            yield { sequence, type: "stopped" };
            return;
          }
          const pendingMessages = messagesSchema.parse(
            await this.#json(`/api/poll?since_id=${cursor}`, { signal }),
          );
          cursor = pendingMessages.reduce(
            (maximum, message) => Math.max(maximum, message.id),
            cursor,
          );
          if (pendingMessages.length > 0) {
            priorRequestPending = pendingMessages.at(-1)?.direction === "in";
          }
          if (!priorRequestPending) break;
          const ready = await wait(this.#pollIntervalMs, signal);
          if (!ready) {
            yield { sequence, type: "stopped" };
            return;
          }
        }
        if (priorRequestPending) {
          throw new YosAdapterFailure(
            "YOS_CHANNEL_BUSY",
            "YOS is still completing an earlier Web Console request",
            true,
          );
        }
      }

      const outboundMessage = "roomId" in request
        ? formatRoomConversation(request)
        : request.message;
      await this.#json("/api/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: outboundMessage }),
        signal,
      });

      yield { sequence, type: "status", status: "running" };
      sequence += 1;
      yield { sequence, type: "status", status: "thinking" };
      sequence += 1;

      const deadline = Date.now() + this.#responseTimeoutMs;
      while (Date.now() < deadline) {
        if (signal.aborted) {
          yield { sequence, type: "stopped" };
          return;
        }

        const messages = messagesSchema.parse(
          await this.#json(`/api/poll?since_id=${cursor}`, { signal }),
        );
        cursor = messages.reduce((maximum, message) => Math.max(maximum, message.id), cursor);
        const response = messages.find(
          (message) => message.direction === "out" && message.content.trim().length > 0,
        );
        if (response) {
          yield { sequence, type: "text_delta", delta: response.content };
          sequence += 1;
          yield { sequence, type: "completed", text: response.content };
          return;
        }

        const ready = await wait(this.#pollIntervalMs, signal);
        if (!ready) {
          yield { sequence, type: "stopped" };
          return;
        }
      }

      yield failureEvent(
        sequence,
        new YosAdapterFailure(
          "YOS_RESPONSE_TIMEOUT",
          "YOS did not reply before the response deadline",
          true,
        ),
      );
    } catch (error) {
      if (signal.aborted) {
        yield { sequence, type: "stopped" };
        return;
      }
      yield failureEvent(sequence, error);
    }
  }

  async #authenticate(signal: AbortSignal): Promise<void> {
    const auth = authSchema.parse(await this.#json("/api/auth", { signal }));
    if (!auth.required || auth.authenticated) return;
    if (!this.#password) {
      throw new YosAdapterFailure(
        "YOS_AUTH_FAILED",
        "YOS Web Console authentication failed",
        false,
      );
    }

    const response = await this.#fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: this.#password }),
      signal,
    });
    if (!response.ok) {
      throw new YosAdapterFailure(
        "YOS_AUTH_FAILED",
        "YOS Web Console authentication failed",
        false,
      );
    }
    const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
    if (!cookie) {
      throw new YosAdapterFailure(
        "YOS_AUTH_FAILED",
        "YOS Web Console authentication failed",
        false,
      );
    }
    this.#cookie = cookie;
  }

  async #json(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.#fetch(path, init);
    if (!response.ok) {
      throw new YosAdapterFailure(
        response.status === 401 ? "YOS_AUTH_FAILED" : "YOS_HTTP_ERROR",
        response.status === 401
          ? "YOS Web Console authentication failed"
          : "YOS Web Console request failed",
        response.status !== 401,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new YosAdapterFailure(
        "YOS_PROTOCOL_ERROR",
        "YOS Web Console returned an invalid response",
        true,
      );
    }
  }

  #fetch(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.#cookie) headers.set("cookie", this.#cookie);
    return fetch(`${this.#baseUrl}${path}`, { ...init, headers }).catch(() => {
      throw new YosAdapterFailure(
        "YOS_CONNECTION_FAILED",
        "YOS Web Console is unavailable",
        true,
      );
    });
  }
}
