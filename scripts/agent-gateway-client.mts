import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface AgentGatewayJob {
  id: string;
  runId: string;
  principalId: string;
  request: Record<string, unknown>;
  leaseId: string;
}

export interface AgentGatewayResource {
  duplicate: boolean;
  attachment: { id: string } & Record<string, unknown>;
}

export type AgentGatewayResult =
  | { type: "completed"; text: string; attachmentIds?: string[] }
  | {
      type: "failed";
      error: { code: string; message: string; retriable: boolean };
    };

export type AgentGatewayHandler = (
  job: AgentGatewayJob,
  signal: AbortSignal,
) => Promise<AgentGatewayResult>;

export type AgentGatewayTokenProvider = () => Promise<string>;

interface AgentGatewayClientOptions {
  baseUrl: string;
  token: string | AgentGatewayTokenProvider;
  fetcher?: typeof fetch;
}

interface AgentGatewayLoopOptions {
  signal: AbortSignal;
  idleDelayMs?: number;
  heartbeatIntervalMs?: number;
  leaseMs?: number;
  onError?: (error: AgentGatewayProtocolError) => void;
}

export class AgentGatewayProtocolError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentGatewayProtocolError";
    this.status = status;
    this.code = code;
  }
}

function normalizedBaseUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Gateway URL must be HTTP(S) and must not contain credentials");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseClaimedJob(value: unknown): AgentGatewayJob {
  if (!value || typeof value !== "object") {
    throw new AgentGatewayProtocolError(502, "INVALID_RESPONSE", "Gateway returned an invalid job");
  }
  const job = (value as { job?: unknown }).job;
  if (!job || typeof job !== "object") {
    throw new AgentGatewayProtocolError(502, "INVALID_RESPONSE", "Gateway returned an invalid job");
  }
  const candidate = job as Record<string, unknown>;
  if (
    !isUuid(candidate.id) ||
    !isUuid(candidate.runId) ||
    !isUuid(candidate.principalId) ||
    !isUuid(candidate.leaseId) ||
    !candidate.request ||
    typeof candidate.request !== "object" ||
    Array.isArray(candidate.request)
  ) {
    throw new AgentGatewayProtocolError(502, "INVALID_RESPONSE", "Gateway returned an invalid job");
  }
  return {
    id: candidate.id,
    runId: candidate.runId,
    principalId: candidate.principalId,
    request: candidate.request as Record<string, unknown>,
    leaseId: candidate.leaseId,
  };
}

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolveWait) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolveWait();
    }, delayMs);
    const stop = () => {
      clearTimeout(timer);
      resolveWait();
    };
    signal.addEventListener("abort", stop, { once: true });
  });
}

function isTerminalGatewayError(error: AgentGatewayProtocolError): boolean {
  return error.status === 401 || error.code === "AGENT_UNAUTHENTICATED";
}

export class AgentGatewayClient {
  readonly #baseUrl: string;
  readonly #provideToken: AgentGatewayTokenProvider;
  readonly #fetcher: typeof fetch;

  constructor(options: AgentGatewayClientOptions) {
    this.#baseUrl = normalizedBaseUrl(options.baseUrl);
    const configuredToken = options.token;
    if (typeof configuredToken === "string") {
      const token = validateAgentToken(configuredToken);
      this.#provideToken = async () => token;
    } else {
      this.#provideToken = async () => validateAgentToken(await configuredToken());
    }
    this.#fetcher = options.fetcher ?? fetch;
  }

  async heartbeat(signal?: AbortSignal): Promise<void> {
    await this.#request("/api/v1/agent-gateway/heartbeat", {}, signal);
  }

  async claimJob(leaseMs = 120_000, signal?: AbortSignal): Promise<AgentGatewayJob | null> {
    const response = await this.#request(
      "/api/v1/agent-gateway/jobs/claim",
      { leaseMs },
      signal,
      true,
    );
    return response === null ? null : parseClaimedJob(response);
  }

  async submitResult(
    jobId: string,
    leaseId: string,
    result: AgentGatewayResult,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!isUuid(jobId) || !isUuid(leaseId)) {
      throw new Error("Job and lease identifiers must be UUIDs");
    }
    await this.#request(
      `/api/v1/agent-gateway/jobs/${jobId}/result`,
      { leaseId, result },
      signal,
    );
  }

  async fetchResource(path: string, signal?: AbortSignal): Promise<Response> {
    if (
      !/^\/api\/v1\/agent-gateway\/resources\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\?runId=[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(path)
    ) {
      throw new Error("Invalid Gateway resource path");
    }
    let token: string;
    try {
      token = await this.#provideToken();
    } catch {
      throw new AgentGatewayProtocolError(
        0,
        "CREDENTIAL_FAILED",
        "Agent credential could not be refreshed",
      );
    }
    let response: Response;
    try {
      response = await this.#fetcher(`${this.#baseUrl}${path}`, {
        method: "GET",
        headers: new Headers({ authorization: `Bearer ${token}` }),
        signal,
      });
    } catch {
      throw new AgentGatewayProtocolError(0, "CONNECTION_FAILED", "Gateway is unavailable");
    }
    if (!response.ok) {
      throw new AgentGatewayProtocolError(
        response.status,
        "RESOURCE_UNAVAILABLE",
        "Gateway resource is unavailable",
      );
    }
    return response;
  }

  async createResource(input: {
    runId: string;
    originalName: string;
    declaredMediaType: string;
    idempotencyKey: string;
  }, signal?: AbortSignal): Promise<AgentGatewayResource> {
    if (!isUuid(input.runId) || !input.originalName.trim() || !input.declaredMediaType.trim()) {
      throw new Error("Invalid Agent resource metadata");
    }
    if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 128) {
      throw new Error("Invalid Agent resource idempotency key");
    }
    const token = await this.#credential();
    let response: Response;
    try {
      response = await this.#fetcher(`${this.#baseUrl}/api/v1/agent-gateway/resources`, {
        method: "POST",
        headers: new Headers({
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
        }),
        body: JSON.stringify({
          runId: input.runId,
          originalName: input.originalName,
          declaredMediaType: input.declaredMediaType,
        }),
        signal,
      });
    } catch {
      throw new AgentGatewayProtocolError(0, "CONNECTION_FAILED", "Gateway is unavailable");
    }
    if (!response.ok) {
      throw new AgentGatewayProtocolError(response.status, "RESOURCE_CREATE_FAILED", "Gateway resource creation failed");
    }
    const payload = await response.json().catch(() => null) as AgentGatewayResource | null;
    if (!payload || typeof payload.duplicate !== "boolean" || !isUuid(payload.attachment?.id)) {
      throw new AgentGatewayProtocolError(502, "INVALID_RESPONSE", "Gateway returned an invalid resource");
    }
    return payload;
  }

  async uploadResource(
    attachmentId: string,
    body: BodyInit,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!isUuid(attachmentId)) throw new Error("Attachment identifier must be a UUID");
    const token = await this.#credential();
    let response: Response;
    try {
      response = await this.#fetcher(
        `${this.#baseUrl}/api/v1/agent-gateway/resources/${attachmentId}/content`,
        {
          method: "PUT",
          headers: new Headers({ authorization: `Bearer ${token}` }),
          body,
          signal,
        },
      );
    } catch {
      throw new AgentGatewayProtocolError(0, "CONNECTION_FAILED", "Gateway is unavailable");
    }
    if (!response.ok) {
      throw new AgentGatewayProtocolError(response.status, "RESOURCE_UPLOAD_FAILED", "Gateway resource upload failed");
    }
  }

  async #credential(): Promise<string> {
    try {
      return await this.#provideToken();
    } catch {
      throw new AgentGatewayProtocolError(
        0,
        "CREDENTIAL_FAILED",
        "Agent credential could not be refreshed",
      );
    }
  }

  async #request(
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
    allowEmpty = false,
  ): Promise<unknown | null> {
    let token: string;
    try {
      token = await this.#provideToken();
    } catch {
      throw new AgentGatewayProtocolError(
        0,
        "CREDENTIAL_FAILED",
        "Agent credential could not be refreshed",
      );
    }
    let response: Response;
    try {
      response = await this.#fetcher(`${this.#baseUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      throw new AgentGatewayProtocolError(0, "CONNECTION_FAILED", "Gateway is unavailable");
    }
    if (allowEmpty && response.status === 204) return null;
    if (!response.ok) {
      let code = "HTTP_ERROR";
      try {
        const payload = await response.json() as { error?: { code?: unknown } };
        if (typeof payload.error?.code === "string") code = payload.error.code;
      } catch {
        // The public error code is optional; response bodies are never echoed.
      }
      throw new AgentGatewayProtocolError(response.status, code, "Gateway request failed");
    }
    try {
      return await response.json();
    } catch {
      throw new AgentGatewayProtocolError(502, "INVALID_RESPONSE", "Gateway returned invalid JSON");
    }
  }
}

function validateAgentToken(token: string): string {
  if (!/^(?:yya|at)_[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error("Agent token is not in the expected format");
  }
  return token;
}

export async function runAgentGatewayOnce(
  client: AgentGatewayClient,
  handler: AgentGatewayHandler,
  options: { signal?: AbortSignal; leaseMs?: number } = {},
): Promise<boolean> {
  const signal = options.signal ?? new AbortController().signal;
  const job = await client.claimJob(options.leaseMs ?? 120_000, signal);
  if (!job) return false;
  let result: AgentGatewayResult;
  try {
    result = await handler(job, signal);
  } catch {
    result = {
      type: "failed",
      error: {
        code: "AGENT_HANDLER_FAILED",
        message: "Agent handler failed",
        retriable: true,
      },
    };
  }
  await client.submitResult(job.id, job.leaseId, result, signal);
  return true;
}

export async function runAgentGatewayLoop(
  client: AgentGatewayClient,
  handler: AgentGatewayHandler,
  options: AgentGatewayLoopOptions,
): Promise<void> {
  const idleDelayMs = Math.max(100, options.idleDelayMs ?? 1_000);
  const heartbeatIntervalMs = Math.max(5_000, options.heartbeatIntervalMs ?? 15_000);
  const leaseMs = Math.min(120_000, Math.max(1_000, options.leaseMs ?? 120_000));
  let heartbeatInFlight = false;
  let terminalError: AgentGatewayProtocolError | undefined;
  const report = (error: unknown) => {
    const safeError = error instanceof AgentGatewayProtocolError
      ? error
      : new AgentGatewayProtocolError(0, "CLIENT_FAILED", "Gateway client failed");
    options.onError?.(safeError);
    return safeError;
  };
  const sendHeartbeat = async () => {
    if (heartbeatInFlight || options.signal.aborted) return;
    heartbeatInFlight = true;
    try {
      await client.heartbeat(options.signal);
    } catch (error) {
      const safeError = report(error);
      if (isTerminalGatewayError(safeError)) terminalError = safeError;
    } finally {
      heartbeatInFlight = false;
    }
  };

  await sendHeartbeat();
  if (terminalError) throw terminalError;
  const heartbeatTimer = setInterval(() => void sendHeartbeat(), heartbeatIntervalMs);
  try {
    while (!options.signal.aborted) {
      if (terminalError) throw terminalError;
      try {
        const worked = await runAgentGatewayOnce(client, handler, {
          signal: options.signal,
          leaseMs,
        });
        if (!worked) await wait(idleDelayMs, options.signal);
      } catch (error) {
        const safeError = report(error);
        if (isTerminalGatewayError(safeError)) throw safeError;
        await wait(idleDelayMs, options.signal);
      }
    }
  } finally {
    clearInterval(heartbeatTimer);
  }
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  process.stderr.write("This module is a client library. Run scripts/run-yos-gateway-agent.mts instead.\n");
  process.exitCode = 1;
}
