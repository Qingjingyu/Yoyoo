import {
  AgentDirectory,
  type AICardResult,
} from "@/components/settings/agent-directory";

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
  return <AgentDirectory aicardResult={aicardResult} />;
}
