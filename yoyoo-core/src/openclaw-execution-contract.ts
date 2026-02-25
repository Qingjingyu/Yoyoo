export type OpenClawSurface =
  | "gateway"
  | "channels"
  | "skills"
  | "hooks"
  | "plugins";

export interface OpenClawHookDiscoveryOrder {
  workspace: string;
  managed: string;
  bundled: string;
}

export interface OpenClawPluginManifest {
  id: string;
  configSchema: Record<string, unknown>;
  kind?: string;
  channels?: string[];
  providers?: string[];
  skills?: string[];
  name?: string;
  description?: string;
  version?: string;
}

export interface OpenClawExecutionContract {
  source: "openclaw-official-docs";
  surfaces: readonly OpenClawSurface[];
  gateway: {
    runCommand: "openclaw gateway";
    statusCommand: "openclaw gateway status";
    probeCommand: "openclaw gateway probe";
  };
  channels: {
    statusCommand: "openclaw channels status";
    capabilitiesCommand: "openclaw channels capabilities";
    resolveCommand: "openclaw channels resolve";
  };
  hooks: {
    listCommand: "openclaw hooks list";
    enableCommand: "openclaw hooks enable <name>";
    discoveryOrder: OpenClawHookDiscoveryOrder;
  };
  skills: {
    listCommand: "openclaw skills list";
    checkCommand: "openclaw skills check";
    configPath: "skills";
    configKeys: readonly ["allowBundled", "load", "install", "entries"];
  };
  plugins: {
    listCommand: "openclaw plugins list";
    installCommand: "openclaw plugins install <path-or-spec>";
    manifestFile: "openclaw.plugin.json";
    requiredManifestKeys: readonly ["id", "configSchema"];
  };
}

const CONTRACT: OpenClawExecutionContract = {
  source: "openclaw-official-docs",
  surfaces: ["gateway", "channels", "skills", "hooks", "plugins"],
  gateway: {
    runCommand: "openclaw gateway",
    statusCommand: "openclaw gateway status",
    probeCommand: "openclaw gateway probe",
  },
  channels: {
    statusCommand: "openclaw channels status",
    capabilitiesCommand: "openclaw channels capabilities",
    resolveCommand: "openclaw channels resolve",
  },
  hooks: {
    listCommand: "openclaw hooks list",
    enableCommand: "openclaw hooks enable <name>",
    discoveryOrder: {
      workspace: "<workspace>/hooks",
      managed: "~/.openclaw/hooks",
      bundled: "<openclaw>/dist/hooks/bundled",
    },
  },
  skills: {
    listCommand: "openclaw skills list",
    checkCommand: "openclaw skills check",
    configPath: "skills",
    configKeys: ["allowBundled", "load", "install", "entries"],
  },
  plugins: {
    listCommand: "openclaw plugins list",
    installCommand: "openclaw plugins install <path-or-spec>",
    manifestFile: "openclaw.plugin.json",
    requiredManifestKeys: ["id", "configSchema"],
  },
};

export function getOpenClawExecutionContract(): OpenClawExecutionContract {
  return CONTRACT;
}

export function isValidPluginManifest(
  input: unknown,
): input is OpenClawPluginManifest {
  if (!input || typeof input !== "object") return false;
  const candidate = input as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) {
    return false;
  }
  if (!candidate.configSchema || typeof candidate.configSchema !== "object") {
    return false;
  }
  return true;
}

