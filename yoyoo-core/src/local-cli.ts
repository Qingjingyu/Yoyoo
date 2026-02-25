import { simulateLocalMessage, type LocalSimInput } from "./local-adapter";

type LogFn = (line: string) => void;

const HELP = `Yoyoo Local CLI

Usage:
  npx tsx yoyoo-core/src/local-cli.ts [options]

Options:
  --channel <name>                 default: local-sim
  --sender-id <id>                 required
  --sender-name <name>
  --conversation-id <id>           required
  --chat-type <group|direct|p2p>   default: direct
  --text <message>                 required
  --skills <a,b,c>                 default: empty
  --admins <a,b,c>                 default: empty
  --memory-bridge-mode <isolated|user-global> default: isolated
  --group-session-scope <per-group|per-user>  default: per-group
  --help
`;

function readFlag(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx < 0) return undefined;
  return argv[idx + 1];
}

function readCsv(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

export function parseCliArgs(argv: string[]): LocalSimInput {
  const senderId = readFlag(argv, "--sender-id");
  const conversationId = readFlag(argv, "--conversation-id");
  const text = readFlag(argv, "--text");

  if (!senderId || !conversationId || text === undefined) {
    throw new Error("missing required args: --sender-id --conversation-id --text");
  }

  const chatTypeRaw = readFlag(argv, "--chat-type") ?? "direct";
  const chatType: LocalSimInput["chatType"] =
    chatTypeRaw === "group" || chatTypeRaw === "direct" || chatTypeRaw === "p2p"
      ? chatTypeRaw
      : "direct";

  const memoryBridgeModeRaw = readFlag(argv, "--memory-bridge-mode") ?? "isolated";
  const memoryBridgeMode: LocalSimInput["memoryBridgeMode"] =
    memoryBridgeModeRaw === "user-global" ? "user-global" : "isolated";

  const groupSessionScopeRaw = readFlag(argv, "--group-session-scope") ?? "per-group";
  const groupSessionScope: LocalSimInput["groupSessionScope"] =
    groupSessionScopeRaw === "per-user" ? "per-user" : "per-group";

  return {
    channel: readFlag(argv, "--channel") ?? "local-sim",
    senderId,
    senderName: readFlag(argv, "--sender-name"),
    conversationId,
    chatType,
    text,
    skills: readCsv(readFlag(argv, "--skills")),
    admins: readCsv(readFlag(argv, "--admins")),
    memoryBridgeMode,
    groupSessionScope,
  };
}

export function runLocalCli(argv: string[], log: LogFn = (line) => console.log(line)): number {
  if (argv.includes("--help")) {
    log(HELP);
    return 0;
  }

  try {
    const input = parseCliArgs(argv);
    const out = simulateLocalMessage(input);
    log(JSON.stringify(out, null, 2));
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Error: ${msg}`);
    log(HELP);
    return 1;
  }
}

if ((process.argv[1] ?? "").includes("local-cli.")) {
  const code = runLocalCli(process.argv.slice(2));
  process.exitCode = code;
}
