export type P0CapabilityId =
  | "p0-1-openclaw-execution"
  | "p0-2-qmd-retrieval"
  | "p0-3-evolver-evolution"
  | "p0-4-memu-letta-memory";

export interface P0Capability {
  id: P0CapabilityId;
  order: 1 | 2 | 3 | 4;
  name: string;
  focus: string;
  landingTarget: "yoyoo-core";
  sources: string[];
}

const P0_CAPABILITIES: readonly P0Capability[] = [
  {
    id: "p0-1-openclaw-execution",
    order: 1,
    name: "OpenClaw execution layer",
    focus: "gateway/channel/skills/plugin boundaries",
    landingTarget: "yoyoo-core",
    sources: [
      "https://github.com/openclaw/openclaw",
      "https://openclaw.ai/",
      "https://clawhub.ai/",
      "https://docs.openclaw.ai/start/getting-started",
    ],
  },
  {
    id: "p0-2-qmd-retrieval",
    order: 2,
    name: "QMD retrieval layer",
    focus: "search-first answer policy with source-aware output",
    landingTarget: "yoyoo-core",
    sources: ["https://github.com/tobi/qmd"],
  },
  {
    id: "p0-3-evolver-evolution",
    order: 3,
    name: "Evolver/EvoMap evolution layer",
    focus: "loop mode, heartbeat, backoff, innovation strategy",
    landingTarget: "yoyoo-core",
    sources: [
      "https://evomap.ai/skill.md",
      "https://evomap.ai/wiki",
      "https://evomap.ai/blog",
      "https://github.com/autogame-17/evolver",
    ],
  },
  {
    id: "p0-4-memu-letta-memory",
    order: 4,
    name: "memU/Letta memory layer",
    focus: "long-term memory abstraction and backend swap",
    landingTarget: "yoyoo-core",
    sources: [
      "https://github.com/NevaMind-AI/memU",
      "https://github.com/letta-ai/letta",
    ],
  },
];

export function getP0Capabilities(): readonly P0Capability[] {
  return P0_CAPABILITIES;
}

export function nextP0Capability(
  done: Partial<Record<P0CapabilityId, boolean>>,
): P0Capability | null {
  for (const item of P0_CAPABILITIES) {
    if (!done[item.id]) return item;
  }
  return null;
}

