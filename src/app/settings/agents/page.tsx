import {
  AgentDirectory,
  type AICardResult,
} from "@/components/settings/agent-directory";
import { getAICardProfileUrl } from "@/server/aicard-integration-config";

const AICARD_RESULTS = new Set<AICardResult>([
  "connected",
  "agent_connected",
  "denied",
  "failed",
  "invalid_session",
  "unavailable",
]);

export default async function AgentsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ aicard?: string }>;
}) {
  const { aicard } = await searchParams;
  const aicardResult =
    aicard && AICARD_RESULTS.has(aicard as AICardResult)
      ? (aicard as AICardResult)
      : undefined;
  const myCardUrl = getAICardProfileUrl() ?? undefined;
  return <AgentDirectory aicardResult={aicardResult} myCardUrl={myCardUrl} />;
}
