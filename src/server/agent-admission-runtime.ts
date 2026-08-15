import { AICardClient } from "@/server/aicard-client";
import {
  getAICardIntegrationConfig,
  getAICardRuntimeConfig,
} from "@/server/aicard-integration-config";
import { AgentAdmissionService } from "@/server/agent-admission-service";
import { HumanAuthConfigurationError } from "@/server/auth/human-auth-http";
import { AgentAdmissionRepository } from "@/server/postgres/agent-admission-repository";
import type { ServerRuntime } from "@/server/runtime";

export function createAgentAdmissionService(runtime: ServerRuntime): AgentAdmissionService {
  const humanAuth = runtime.humanAuth.service;
  const publicOrigin = runtime.humanAuth.publicOrigin;
  if (!humanAuth || !publicOrigin) {
    throw new HumanAuthConfigurationError(
      "Agent onboarding requires AI Card human authentication",
    );
  }
  const integration = getAICardIntegrationConfig();
  const runtimeConfig = getAICardRuntimeConfig();
  return new AgentAdmissionService({
    repository: new AgentAdmissionRepository(runtime.pool),
    aicard: new AICardClient(integration),
    getHumanAccessToken: (session) => humanAuth.getFederatedAccessToken(session),
    publicOrigin,
    identityIssuer: integration.issuer,
    clientId: integration.clientId,
    audience: runtimeConfig?.audience ?? "yoyoo",
  });
}
