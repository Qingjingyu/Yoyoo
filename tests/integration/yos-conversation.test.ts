/** @vitest-environment node */

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { AgentRegistry } from "@/agents/registry";
import { YosWebConsoleAdapter } from "@/agents/yos-adapter";
import { ConversationService } from "@/server/conversation-service";
import { ConversationRepository } from "@/server/postgres/conversation-repository";
import { createPostgresPool } from "@/server/postgres/client";
import { RunRepository } from "@/server/postgres/run-repository";
import { RunCoordinator } from "@/server/run-coordinator";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";
const pool = createPostgresPool(databaseUrl, { max: 2 });

afterAll(async () => {
  await pool.end();
});

describe("YOS conversation integration", () => {
  it("persists one whole Web Console reply through the general conversation service", async () => {
    let nextPoll = 0;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://fixture");
      res.setHeader("content-type", "application/json");
      if (url.pathname === "/api/auth") return res.end(JSON.stringify({ required: false, authenticated: true }));
      if (url.pathname === "/api/conversations/recent") return res.end("[]");
      if (url.pathname === "/api/send") return res.end(JSON.stringify({ success: true }));
      if (url.pathname === "/api/poll") {
        nextPoll += 1;
        return res.end(nextPoll === 1
          ? "[]"
          : JSON.stringify([{ id: 1, direction: "out", content: "来自 YOS fixture 的回复" }]));
      }
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: "not found" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Fixture failed to listen");
      const adapter = new YosWebConsoleAdapter({
        baseUrl: `http://127.0.0.1:${address.port}`,
        pollIntervalMs: 1,
        responseTimeoutMs: 200,
      });
      const conversations = new ConversationRepository(pool);
      const runs = new RunRepository(pool);
      const coordinator = new RunCoordinator(runs, new AgentRegistry([adapter]));
      const service = new ConversationService(conversations, runs, coordinator);
      const ownerId = `yos-fixture-${randomUUID()}`;

      const submission = await service.submitMessage({
        ownerId,
        agentId: adapter.descriptor.id,
        content: "发送给 YOS fixture",
        idempotencyKey: randomUUID(),
      });
      await coordinator.waitFor(submission.run.id);

      const snapshot = await service.getCurrent(ownerId, adapter.descriptor.id);
      expect(snapshot.capabilities.cancellation).toBe(false);
      expect(snapshot.messages).toMatchObject([
        { senderType: "human", content: "发送给 YOS fixture", status: "completed" },
        { senderType: "agent", content: "来自 YOS fixture 的回复", status: "completed" },
      ]);
      expect((await runs.listEvents(submission.run.id)).map((entry) => entry.event.type)).toEqual([
        "status",
        "status",
        "text_delta",
        "completed",
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
