import { handleInbound, type OrchestratorInput } from "./orchestrator";
export { preprocessClawInbound } from "./claw-bridge";
export { handleClawInboundWithYoyoo } from "./claw-adapter-template";
export { runOpenClawAgentViaCli, runYoyooOpenClawTurn } from "./openclaw-local-bridge";
export { buildYoyooPromptInjection, parseSessionHint } from "./openclaw-autobridge";
export {
  appendSharedMemoryLog,
  buildTieredSharedMemoryContext,
  cleanupExpiredSharedMemoryLogs,
  ensureSharedMemoryScaffold,
} from "./collaboration-memory";
export {
  defaultEvolverGateState,
  onEvolverFailure,
  onEvolverSuccess,
  runEvolverSafely,
  shouldRunEvolverLoop,
} from "./evolver-gate";
export { tickEvolverLoop } from "./evolver-loop-runner";
export {
  buildMemoryNamespace,
  createHttpJsonMemoryBackend,
  createInMemoryMemoryBackend,
  createMemoryService,
} from "./memory-abstraction";
export { runMultiTeamCollaboration } from "./multi-team-collab";

export function createYoyooCore() {
  return {
    name: "yoyoo-core-v1",
    handle(input: OrchestratorInput) {
      return handleInbound(input);
    },
  };
}
