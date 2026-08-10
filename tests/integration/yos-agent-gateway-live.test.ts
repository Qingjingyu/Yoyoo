/** @vitest-environment node */

import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadEnvFile } from "node:process";

import { expect, it } from "vitest";

import { YosWebConsoleAdapter } from "@/agents/yos-adapter";
import { GET as getAgentResource } from "@/app/api/v1/agent-gateway/resources/[attachmentId]/route";
import { GATEWAY_ADAPTER_ID } from "@/server/postgres/agent-gateway-repository";
import { RoomRepository } from "@/server/postgres/room-repository";
import { closeServerRuntime, getServerRuntime } from "@/server/runtime";
import { AgentGatewayClient } from "../../scripts/agent-gateway-client.mts";
import { createYosGatewayHandler } from "../../scripts/run-yos-gateway-agent.mts";

const liveTest = process.env.YOS_GATEWAY_LIVE_TEST === "1" ? it : it.skip;

liveTest(
  "bridges one real YOS reply through the Agent Gateway handler",
  async () => {
    loadEnvFile(
      process.env.YOYOO_YOS_ENV_FILE?.trim() || join(homedir(), "yos", ".env"),
    );
    const baseUrl = process.env.YOS_WEB_CONSOLE_URL?.trim() ||
      `http://127.0.0.1:${process.env.WEB_CONSOLE_PORT?.trim() || "3457"}`;
    const adapter = new YosWebConsoleAdapter({
      baseUrl,
      password: process.env.YOS_WEB_PASSWORD,
      pollIntervalMs: 500,
      responseTimeoutMs: 110_000,
    });
    const handler = createYosGatewayHandler(adapter);
    const runId = randomUUID();
    const result = await handler(
      {
        id: randomUUID(),
        runId,
        principalId: randomUUID(),
        request: {
          runId,
          conversationId: randomUUID(),
          message: `Yoyoo Gateway live test ${randomUUID()}: reply with OK`,
        },
        leaseId: randomUUID(),
      },
      new AbortController().signal,
    );

    expect(result).toMatchObject({ type: "completed" });
    if (result.type === "completed") expect(result.text.trim()).not.toBe("");
  },
  120_000,
);

liveTest(
  "reads one authorized Yoyoo file through real YOS and denies the next read after revocation",
  async () => {
    const priorEnvironment = {
      DATABASE_URL: process.env.DATABASE_URL,
      YOYOO_AGENT_ADAPTER: process.env.YOYOO_AGENT_ADAPTER,
      YOYOO_LOCAL_OWNER_ID: process.env.YOYOO_LOCAL_OWNER_ID,
    };
    const restore = (key: keyof typeof priorEnvironment) => {
      const value = priorEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    loadEnvFile(
      process.env.YOYOO_YOS_ENV_FILE?.trim() || join(homedir(), "yos", ".env"),
    );
    const baseUrl = process.env.YOS_WEB_CONSOLE_URL?.trim() ||
      `http://127.0.0.1:${process.env.WEB_CONSOLE_PORT?.trim() || "3457"}`;
    const databaseUrl = process.env.TEST_DATABASE_URL ??
      "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";

    try {
      await closeServerRuntime();
      process.env.DATABASE_URL = databaseUrl;
      process.env.YOYOO_AGENT_ADAPTER = "deterministic-test";
      process.env.YOYOO_LOCAL_OWNER_ID = `yos-file-live-${randomUUID()}`;
      const runtime = await getServerRuntime();
      const created = await runtime.gateway.repository.createAgent({
        workspaceId: runtime.collaboration.bootstrap.workspace.id,
        actorPrincipalId: runtime.collaboration.bootstrap.principal.id,
        handle: `yos-file-${randomUUID().slice(0, 8)}`,
        displayName: "YOS File Agent",
      });
      const rooms = new RoomRepository(runtime.pool);
      await rooms.addMember({
        roomId: runtime.collaboration.bootstrap.room.id,
        principalId: created.agent.principalId,
        role: "member",
        listenerPolicy: "mention_only",
      });

      const marker = `YOYOO_FILE_READY_${randomUUID().slice(0, 8)}`;
      const bytes = Buffer.from(marker, "utf8");
      const pending = await runtime.attachments.service.beginUpload({
        workspaceId: runtime.collaboration.bootstrap.workspace.id,
        principalId: runtime.collaboration.bootstrap.principal.id,
        idempotencyKey: randomUUID(),
        originalName: "private-marker.txt",
        declaredMediaType: "text/plain",
      });
      const ready = await runtime.attachments.service.completeUpload({
        attachmentId: pending.attachment.id,
        principalId: runtime.collaboration.bootstrap.principal.id,
        source: (async function* () { yield bytes; })(),
      });
      const trigger = await rooms.createMessage({
        roomId: runtime.collaboration.bootstrap.room.id,
        senderPrincipalId: runtime.collaboration.bootstrap.principal.id,
        kind: "message",
        content: "读取附件，并且只回复附件中的唯一标记。",
        status: "completed",
        idempotencyKey: randomUUID(),
        mentionedPrincipalIds: [created.agent.principalId],
        attachmentIds: [ready.id],
      });
      const [run] = await runtime.collaboration.runs.createForMessage({
        roomId: runtime.collaboration.bootstrap.room.id,
        triggerMessageId: trigger.message.id,
        targets: [{
          principalId: created.agent.principalId,
          adapterId: GATEWAY_ADAPTER_ID,
        }],
      });
      await runtime.collaboration.runs.claim(run.id);
      await runtime.attachments.repository.createAccessGrant({
        workspaceId: runtime.collaboration.bootstrap.workspace.id,
        roomId: runtime.collaboration.bootstrap.room.id,
        attachmentId: ready.id,
        runId: run.id,
        principalId: created.agent.principalId,
        expiresAt: new Date(Date.now() + 120_000),
      });
      const execution = await runtime.collaboration.runs.getExecutionContext(run.id);
      if (!("workspaceId" in execution.request)) {
        throw new Error("Expected a room-scoped Gateway request");
      }
      const fetcher: typeof fetch = async (input, init) => {
        const request = new Request(input, init);
        const attachmentId = new URL(request.url).pathname.split("/").at(-1);
        if (!attachmentId) return new Response(null, { status: 404 });
        return getAgentResource(request, {
          params: Promise.resolve({ attachmentId }),
        });
      };
      const client = new AgentGatewayClient({
        baseUrl: "http://localhost",
        token: created.token,
        fetcher,
      });
      const adapter = new YosWebConsoleAdapter({
        baseUrl,
        password: process.env.YOS_WEB_PASSWORD,
        pollIntervalMs: 500,
        responseTimeoutMs: 110_000,
      });
      const handler = createYosGatewayHandler(adapter, { resourceClient: client });
      const result = await handler({
        id: randomUUID(),
        runId: run.id,
        principalId: created.agent.principalId,
        request: execution.request,
        leaseId: randomUUID(),
      }, new AbortController().signal);

      expect(result).toMatchObject({ type: "completed" });
      if (result.type !== "completed") throw new Error("YOS file run did not complete");
      expect(result.text).toContain(marker);
      await runtime.collaboration.runs.appendEvent(run.id, {
        sequence: 1,
        type: "completed",
        text: result.text,
      });
      const restored = await runtime.collaboration.service.getSnapshot(
        runtime.collaboration.bootstrap.room.id,
      );
      expect(restored.messages).toContainEqual(expect.objectContaining({
        senderPrincipalId: created.agent.principalId,
        content: expect.stringContaining(marker),
        status: "completed",
      }));

      await runtime.gateway.repository.revokeCredential({
        workspaceId: runtime.collaboration.bootstrap.workspace.id,
        actorPrincipalId: runtime.collaboration.bootstrap.principal.id,
        principalId: created.agent.principalId,
      });
      const resourcePath = execution.request.attachments?.[0]?.resource.path;
      expect(resourcePath).toBeTruthy();
      await expect(client.fetchResource(resourcePath!)).rejects.toMatchObject({
        code: "RESOURCE_UNAVAILABLE",
      });
    } finally {
      await closeServerRuntime();
      restore("DATABASE_URL");
      restore("YOYOO_AGENT_ADAPTER");
      restore("YOYOO_LOCAL_OWNER_ID");
    }
  },
  130_000,
);
