import type { AgentAdapter } from "@/agents/contract";
import { join } from "node:path";

import { AgentGatewayAdapter } from "@/agents/agent-gateway-adapter";
import {
  CodexCliAdapter,
  CodexCliProcessRunner,
} from "@/agents/codex-cli-adapter";
import { AgentRegistry } from "@/agents/registry";
import { DeterministicTestAdapter } from "@/agents/test-adapter";
import { YosWebConsoleAdapter } from "@/agents/yos-adapter";
import { CollaborationDemoAdapter } from "@/agents/collaboration-demo-adapter";
import {
  bootstrapLocalCollaboration,
  type CollaborationAgentSeed,
} from "@/server/collaboration-bootstrap";
import { CollaborationRunCoordinator } from "@/server/collaboration-run-coordinator";
import { CollaborationService } from "@/server/collaboration-service";
import {
  AgentGatewayService,
  createConfiguredAgentGatewayService,
} from "@/server/agent-gateway-service";
import { getAICardRuntimeConfig } from "@/server/aicard-integration-config";
import { ArtifactRepository } from "@/server/postgres/artifact-repository";
import { AttachmentRepository } from "@/server/postgres/attachment-repository";
import {
  AgentGatewayRepository,
  GATEWAY_ADAPTER_ID,
} from "@/server/postgres/agent-gateway-repository";
import { CollaborationRunRepository } from "@/server/postgres/collaboration-run-repository";
import { DelegationRepository } from "@/server/postgres/delegation-repository";
import { PrincipalRepository } from "@/server/postgres/principal-repository";
import { MemberStateRepository } from "@/server/postgres/member-state-repository";
import { RoomRepository } from "@/server/postgres/room-repository";
import { ConversationService } from "@/server/conversation-service";
import { ConversationRepository } from "@/server/postgres/conversation-repository";
import { createPostgresPool } from "@/server/postgres/client";
import { RunRepository } from "@/server/postgres/run-repository";
import { RunCoordinator } from "@/server/run-coordinator";
import { AttachmentService } from "@/server/attachment-service";
import { LocalBlobStore } from "@/server/local-blob-store";
import { SearchRepository } from "@/server/postgres/search-repository";
import { SearchService } from "@/server/search-service";

export const DEFAULT_AGENT_ID = "yoyoo-test-agent";

type AgentEnvironment = Readonly<Record<string, string | undefined>>;

function optionalNumber(value: string | undefined): number | undefined {
  return value === undefined || value.trim() === "" ? undefined : Number(value);
}

export function createConfiguredAgentAdapter(
  environment: AgentEnvironment = process.env,
): AgentAdapter {
  const selection = environment.YOYOO_AGENT_ADAPTER?.trim() || "deterministic-test";
  if (selection === "deterministic-test") {
    const configuredDelay = Number(environment.YOYOO_TEST_AGENT_DELAY_MS ?? 180);
    const delayMs = Number.isFinite(configuredDelay)
      ? Math.min(Math.max(configuredDelay, 0), 5_000)
      : 180;
    return new DeterministicTestAdapter({
      id: DEFAULT_AGENT_ID,
      displayName: "Yoyoo Test Agent",
      chunks: ["我已经收到。", "这是一条来自通用测试 Agent 的持久化回复。"],
      delayMs,
      cancellation: true,
    });
  }

  if (selection === "yos-web-console") {
    const explicitUrl = environment.YOS_WEB_CONSOLE_URL?.trim();
    const localPort = environment.WEB_CONSOLE_PORT?.trim();
    const baseUrl = explicitUrl || (localPort ? `http://127.0.0.1:${localPort}` : "");
    if (!baseUrl) throw new Error("YOS_WEB_CONSOLE_URL is required");
    return new YosWebConsoleAdapter({
      baseUrl,
      password: environment.YOS_WEB_PASSWORD,
      pollIntervalMs: optionalNumber(environment.YOS_POLL_INTERVAL_MS),
      responseTimeoutMs: optionalNumber(environment.YOS_RESPONSE_TIMEOUT_MS),
    });
  }

  throw new Error(`Unsupported YOYOO_AGENT_ADAPTER: ${selection}`);
}

export function createCodexCliAdapter(
  environment: AgentEnvironment = process.env,
): CodexCliAdapter {
  return new CodexCliAdapter({
    runner: new CodexCliProcessRunner({
      command: environment.YOYOO_CODEX_COMMAND,
      timeoutMs: optionalNumber(environment.YOYOO_CODEX_TIMEOUT_MS),
      environment,
    }),
  });
}

export function getLocalOwnerId(): string {
  return process.env.YOYOO_LOCAL_OWNER_ID?.trim() || "local-owner";
}

const LOCAL_REVIEWER_EXTERNAL_KEY = "agent:yoyoo-local-reviewer";
const LOCAL_PLANNER_EXTERNAL_KEY = "agent:yoyoo-local-planner";

export function createCollaborationAgentSeeds(
  selectedAdapter: AgentAdapter,
  codexAdapter?: AgentAdapter,
): CollaborationAgentSeed[] {
  const usesYos = selectedAdapter.descriptor.id === "yos-web-console";
  if (usesYos && !codexAdapter) {
    throw new Error("Codex CLI adapter is required when YOS is selected");
  }
  const thirdAgent = selectedAdapter.descriptor.id === "yos-web-console"
    ? {
        adapterId: selectedAdapter.descriptor.id,
        displayName: selectedAdapter.descriptor.displayName,
        handle: "yos",
        capabilities: selectedAdapter.descriptor.capabilities,
        externalKey: LOCAL_REVIEWER_EXTERNAL_KEY,
      }
    : {
        adapterId: "yoyoo-local-reviewer",
        displayName: "Local Reviewer",
        handle: "reviewer",
        capabilities: {
          streaming: true,
          cancellation: true,
          delegation: false,
          artifacts: false,
          attachments: true,
        },
        externalKey: LOCAL_REVIEWER_EXTERNAL_KEY,
      };

  const firstAgent = usesYos
    ? {
        adapterId: codexAdapter!.descriptor.id,
        displayName: codexAdapter!.descriptor.displayName,
        handle: "codex",
        capabilities: codexAdapter!.descriptor.capabilities,
        externalKey: LOCAL_PLANNER_EXTERNAL_KEY,
      }
    : {
        adapterId: "yoyoo-local-planner",
        displayName: "Local Planner",
        handle: "planner",
        capabilities: {
          streaming: true,
          cancellation: true,
          delegation: true,
          artifacts: false,
          attachments: true,
        },
        externalKey: LOCAL_PLANNER_EXTERNAL_KEY,
      };

  return [
    firstAgent,
    {
      adapterId: "yoyoo-local-builder",
      displayName: "Local Builder",
      handle: "builder",
      capabilities: {
        streaming: true,
        cancellation: true,
        delegation: false,
        artifacts: true,
        attachments: true,
      },
    },
    thirdAgent,
  ];
}

export interface ServerRuntime {
  agentId: string;
  conversations: ConversationRepository;
  coordinator: RunCoordinator;
  pool: ReturnType<typeof createPostgresPool>;
  runs: RunRepository;
  service: ConversationService;
  attachments: {
    repository: AttachmentRepository;
    service: AttachmentService;
  };
  search: SearchService;
  collaboration: {
    bootstrap: Awaited<ReturnType<typeof bootstrapLocalCollaboration>>;
    coordinator: CollaborationRunCoordinator;
    memberStates: MemberStateRepository;
    runs: CollaborationRunRepository;
    service: CollaborationService;
  };
  gateway: {
    repository: AgentGatewayRepository;
    service: AgentGatewayService;
  };
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __yoyooRuntime?: Promise<ServerRuntime>;
};

async function createRuntime(): Promise<ServerRuntime> {
  const pool = createPostgresPool();
  const conversations = new ConversationRepository(pool);
  const runs = new RunRepository(pool);
  const adapter = createConfiguredAgentAdapter();
  const codexAdapter = adapter.descriptor.id === "yos-web-console"
    ? createCodexCliAdapter()
    : undefined;
  const registry = new AgentRegistry([adapter]);
  const coordinator = new RunCoordinator(runs, registry);
  const service = new ConversationService(conversations, runs, coordinator);
  await coordinator.reconcileInterruptedRuns();
  const principalRepository = new PrincipalRepository(pool);
  const roomRepository = new RoomRepository(pool, {
    maxMessageAttachmentBytes: optionalNumber(
      process.env.YOYOO_MAX_MESSAGE_ATTACHMENT_BYTES,
    ),
  });
  const memberStateRepository = new MemberStateRepository(pool);
  const collaborationRuns = new CollaborationRunRepository(pool);
  const gateway = new AgentGatewayRepository(pool);
  const delegationRepository = new DelegationRepository(pool);
  const artifactRepository = new ArtifactRepository(pool);
  const attachmentRepository = new AttachmentRepository(pool);
  const attachmentService = new AttachmentService(
    attachmentRepository,
    new LocalBlobStore(
      process.env.YOYOO_BLOB_ROOT?.trim() || join(process.cwd(), ".data", "blobs"),
    ),
    { maxFileBytes: optionalNumber(process.env.YOYOO_MAX_FILE_BYTES) },
  );
  const searchService = new SearchService(new SearchRepository(pool));
  const demoDelay = Math.min(
    Math.max(Number(process.env.YOYOO_TEST_AGENT_DELAY_MS ?? 80) || 80, 0),
    5_000,
  );
  const seeds = createCollaborationAgentSeeds(adapter, codexAdapter);
  const collaborationBootstrap = await bootstrapLocalCollaboration(
    pool,
    getLocalOwnerId(),
    seeds,
  );
  const agentByAdapterId = new Map(
    collaborationBootstrap.agents.map((agent) => [agent.binding.adapterId, agent]),
  );
  const builderPrincipalId = agentByAdapterId.get("yoyoo-local-builder")!.principal.id;
  const collaborationAdapters: AgentAdapter[] = [
    codexAdapter ?? new CollaborationDemoAdapter({
        id: "yoyoo-local-planner",
        displayName: "Local Planner",
        role: "planner",
        delegatePrincipalId: builderPrincipalId,
        delayMs: demoDelay,
      }),
    new CollaborationDemoAdapter({
      id: "yoyoo-local-builder",
      displayName: "Local Builder",
      role: "builder",
      delayMs: demoDelay,
    }),
    adapter.descriptor.id === "yos-web-console"
      ? adapter
      : new CollaborationDemoAdapter({
          id: "yoyoo-local-reviewer",
          displayName: "Local Reviewer",
          role: "reviewer",
          delayMs: demoDelay,
          failurePattern: process.env.YOYOO_DEMO_REVIEWER_FAILURE_PATTERN,
        }),
    new AgentGatewayAdapter(gateway, {
      pollIntervalMs: optionalNumber(process.env.YOYOO_GATEWAY_POLL_INTERVAL_MS),
      responseTimeoutMs: optionalNumber(process.env.YOYOO_GATEWAY_RESPONSE_TIMEOUT_MS),
    }),
  ];
  const collaborationCoordinator = new CollaborationRunCoordinator(
    collaborationRuns,
    new AgentRegistry(collaborationAdapters),
    principalRepository,
    delegationRepository,
    artifactRepository,
    attachmentRepository,
  );
  await collaborationCoordinator.reconcileInterruptedRuns([GATEWAY_ADAPTER_ID]);
  const interruptedGatewayRunIds = await collaborationRuns.requeueInterruptedRuns(
    GATEWAY_ADAPTER_ID,
  );
  const collaborationService = new CollaborationService(
    roomRepository,
    collaborationRuns,
    collaborationCoordinator,
    delegationRepository,
    artifactRepository,
    attachmentRepository,
    memberStateRepository,
  );
  for (const runId of interruptedGatewayRunIds) {
    void collaborationCoordinator.start(runId);
  }
  return {
    agentId: adapter.descriptor.id,
    conversations,
    coordinator,
    pool,
    runs,
    service,
    attachments: {
      repository: attachmentRepository,
      service: attachmentService,
    },
    search: searchService,
    collaboration: {
      bootstrap: collaborationBootstrap,
      coordinator: collaborationCoordinator,
      memberStates: memberStateRepository,
      runs: collaborationRuns,
      service: collaborationService,
    },
    gateway: {
      repository: gateway,
      service: createConfiguredAgentGatewayService(
        gateway,
        getAICardRuntimeConfig(),
      ),
    },
  };
}

export function getServerRuntime(): Promise<ServerRuntime> {
  runtimeGlobal.__yoyooRuntime ??= createRuntime();
  return runtimeGlobal.__yoyooRuntime;
}

export async function closeServerRuntime(): Promise<void> {
  const runtime = await runtimeGlobal.__yoyooRuntime;
  if (runtime) {
    await runtime.collaboration.coordinator.shutdown();
    await runtime.pool.end();
  }
  delete runtimeGlobal.__yoyooRuntime;
}
