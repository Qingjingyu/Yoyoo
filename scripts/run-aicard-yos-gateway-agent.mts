import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import { YosWebConsoleAdapter } from "../src/agents/yos-adapter.ts";
import { AgentGatewayClient, runAgentGatewayLoop } from "./agent-gateway-client.mts";
import {
  AICardRuntimeTokenProvider,
  loadAICardNodeCredential,
  loadAICardNodePrivateKey,
} from "./aicard-runtime-token-provider.mts";
import { createYosGatewayHandler } from "./run-yos-gateway-agent.mts";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function finiteEnvironment(name: string, fallback: number, maximum: number): number {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive number`);
  }
  return Math.min(maximum, Math.floor(parsed));
}

async function main(): Promise<void> {
  if (existsSync(".env.local")) loadEnvFile(".env.local");
  const yosEnvFile = process.env.YOYOO_YOS_ENV_FILE?.trim()
    || join(homedir(), "yos", ".env");
  loadEnvFile(yosEnvFile);

  const credentialFile = process.env.AICARD_NODE_CREDENTIAL_FILE?.trim();
  const credential = credentialFile
    ? loadAICardNodeCredential(credentialFile)
    : {
        nodeId: requiredEnvironment("AICARD_NODE_ID"),
        privateKey: loadAICardNodePrivateKey(
          requiredEnvironment("AICARD_NODE_PRIVATE_KEY_FILE"),
        ),
      };
  const provider = new AICardRuntimeTokenProvider({
    issuer: requiredEnvironment("YOYOO_AICARD_ISSUER"),
    nodeId: credential.nodeId,
    clientId: requiredEnvironment("YOYOO_AICARD_CLIENT_ID"),
    audience: process.env.YOYOO_AICARD_AUDIENCE?.trim() || "yoyoo",
    privateKey: credential.privateKey,
  });
  const client = new AgentGatewayClient({
    baseUrl: requiredEnvironment("YOYOO_GATEWAY_URL"),
    token: () => provider.getToken(),
  });
  const yosUrl = process.env.YOS_WEB_CONSOLE_URL?.trim()
    || `http://127.0.0.1:${process.env.WEB_CONSOLE_PORT?.trim() || "3457"}`;
  const adapter = new YosWebConsoleAdapter({
    baseUrl: yosUrl,
    password: process.env.YOS_WEB_PASSWORD,
    pollIntervalMs: finiteEnvironment("YOS_POLL_INTERVAL_MS", 500, 10_000),
    responseTimeoutMs: finiteEnvironment(
      "YOS_RESPONSE_TIMEOUT_MS",
      110_000,
      110_000,
    ),
  });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  process.stdout.write("AI Card YOS Gateway Agent starting\n");
  await runAgentGatewayLoop(client, createYosGatewayHandler(adapter, {
    resourceClient: client,
  }), {
    signal: controller.signal,
    leaseMs: 120_000,
    onError: (error) => {
      process.stderr.write(`AI Card YOS Gateway Agent: ${error.code}\n`);
    },
  });
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown startup error";
    process.stderr.write(`AI Card YOS Gateway Agent failed to start: ${message}\n`);
    process.exitCode = 1;
  }
}
