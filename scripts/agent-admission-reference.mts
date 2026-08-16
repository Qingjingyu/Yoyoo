import {
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { open, readFile, rename, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const inputSchema = z.object({
  version: z.literal(1),
  identityServiceUrl: z.url(),
  identityInvitationId: z.uuid(),
  identityTicket: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  machineName: z.string().regex(/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/),
  yoyooServiceUrl: z.url(),
  yoyooInvitationId: z.uuid(),
  yoyooTicket: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  clientId: z.string().regex(/^[a-z][a-z0-9_-]{2,63}$/),
}).strict();

const storedSchema = z.object({
  version: z.literal(1),
  status: z.enum(["identity_pending", "identity_claimed", "admitted"]),
  identityServiceUrl: z.url(),
  identityInvitationId: z.uuid(),
  identityTicket: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
  unusedIdentityDeclined: z.boolean().optional(),
  identityClaimId: z.uuid(),
  claimSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  machineName: z.string(),
  publicKeySpki: z.string(),
  privateKeyPkcs8: z.string(),
  yoyooServiceUrl: z.url(),
  yoyooInvitationId: z.uuid(),
  yoyooTicket: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
  yoyooClaimId: z.uuid(),
  clientId: z.string(),
  nodeId: z.uuid().optional(),
  cardId: z.string().regex(/^AI_[1-9][0-9]{5,}$/).optional(),
  displayName: z.string().optional(),
  connectionStatus: z.literal("connected").optional(),
  principalId: z.uuid().optional(),
  roomIds: z.array(z.uuid()).optional(),
}).strict();

const existingIdentityCredentialSchema = z.object({
  version: z.literal(1),
  serviceUrl: z.url(),
  cardId: z.string().regex(/^AI_[1-9][0-9]{5,}$/),
  nodeId: z.uuid(),
  machineName: z.string().regex(/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/),
  publicKeySpki: z.string().regex(/^[A-Za-z0-9_-]{40,342}$/),
  privateKeyPkcs8: z.string().regex(/^[A-Za-z0-9_-]{40,342}$/),
}).passthrough();

const identityResultSchema = z.object({
  nodeId: z.uuid(),
  cardId: z.string().regex(/^AI_[1-9][0-9]{5,}$/),
  displayName: z.string().trim().min(1),
  machineName: z.string().trim().min(1),
  claimStatus: z.literal("claimed"),
  connectionStatus: z.literal("connected"),
}).passthrough();

const challengeSchema = z.object({
  challengeId: z.uuid(),
  challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).passthrough();

const runtimeSchema = z.object({
  nodeId: z.uuid(),
  connectionStatus: z.literal("connected"),
  runtime: z.object({
    accessToken: z.string().regex(/^at_[A-Za-z0-9_-]{43}$/),
    clientId: z.string(),
    scope: z.literal("agent.runtime"),
  }).passthrough(),
}).passthrough();

const admissionSchema = z.object({
  admission: z.object({
    invitationId: z.uuid(),
    principalId: z.uuid(),
    cardId: z.string().regex(/^AI_[1-9][0-9]{5,}$/),
    displayName: z.string().trim().min(1),
    nodeId: z.uuid(),
    roomIds: z.array(z.uuid()),
    status: z.literal("admitted"),
  }).passthrough(),
}).strict();

type AdmissionInput = z.infer<typeof inputSchema>;
type StoredCredential = z.infer<typeof storedSchema>;

function createUuidV7(timestamp = Date.now()): string {
  const bytes = randomBytes(16);
  let milliseconds = BigInt(timestamp);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(milliseconds & 0xffn);
    milliseconds >>= 8n;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export interface AgentAdmissionSummary {
  displayName: string;
  cardId: string;
  machineName: string;
  approvalStatus: "admitted";
  connectionStatus: "connected";
  roomIds: string[];
}

function normalizedOrigin(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Service URL must be HTTP(S) without embedded credentials");
  }
  return url.origin;
}

async function postJson(
  fetcher: typeof fetch,
  url: string,
  body: Record<string, unknown>,
  accessToken?: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Agent admission service is unavailable");
  }
  const payload = await response.json().catch(() => null) as {
    error?: { message?: unknown };
  } | null;
  if (!response.ok) {
    const message = typeof payload?.error?.message === "string"
      ? payload.error.message
      : `Agent admission request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

async function persist(path: string, credential: StoredCredential, initial = false): Promise<void> {
  const encoded = `${JSON.stringify(credential, null, 2)}\n`;
  if (initial) {
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(encoded, "utf8");
    } finally {
      await handle.close();
    }
    return;
  }
  const temporary = `${path}.tmp-${randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(encoded, "utf8");
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

async function loadCredential(path: string): Promise<StoredCredential | null> {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
      throw new Error("Agent credential file must be private (mode 0600)");
    }
    return storedSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function loadExistingIdentity(path: string): Promise<z.infer<typeof existingIdentityCredentialSchema>> {
  const metadata = await stat(path);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
    throw new Error("Existing AI Card credential file must be private (mode 0600)");
  }
  return existingIdentityCredentialSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

async function createCredential(input: AdmissionInput, output: string): Promise<StoredCredential> {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const credential: StoredCredential = {
    version: 1,
    status: "identity_pending",
    identityServiceUrl: normalizedOrigin(input.identityServiceUrl),
    identityInvitationId: input.identityInvitationId,
    identityTicket: input.identityTicket,
    identityClaimId: createUuidV7(),
    claimSecret: randomBytes(32).toString("base64url"),
    machineName: input.machineName,
    publicKeySpki: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
    privateKeyPkcs8: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    yoyooServiceUrl: normalizedOrigin(input.yoyooServiceUrl),
    yoyooInvitationId: input.yoyooInvitationId,
    yoyooTicket: input.yoyooTicket,
    yoyooClaimId: createUuidV7(),
    clientId: input.clientId,
  };
  await persist(output, credential, true);
  return credential;
}

async function reuseCredential(
  input: AdmissionInput,
  output: string,
  identityPath: string,
): Promise<StoredCredential> {
  const identity = await loadExistingIdentity(identityPath);
  if (normalizedOrigin(identity.serviceUrl) !== normalizedOrigin(input.identityServiceUrl)) {
    throw new Error("Existing AI Card credential belongs to a different identity service");
  }
  const credential: StoredCredential = {
    version: 1,
    status: "identity_claimed",
    identityServiceUrl: normalizedOrigin(input.identityServiceUrl),
    identityInvitationId: input.identityInvitationId,
    identityTicket: input.identityTicket,
    unusedIdentityDeclined: false,
    identityClaimId: createUuidV7(),
    claimSecret: randomBytes(32).toString("base64url"),
    machineName: identity.machineName,
    publicKeySpki: identity.publicKeySpki,
    privateKeyPkcs8: identity.privateKeyPkcs8,
    yoyooServiceUrl: normalizedOrigin(input.yoyooServiceUrl),
    yoyooInvitationId: input.yoyooInvitationId,
    yoyooTicket: input.yoyooTicket,
    yoyooClaimId: createUuidV7(),
    clientId: input.clientId,
    nodeId: identity.nodeId,
    cardId: identity.cardId,
    connectionStatus: "connected",
  };
  await persist(output, credential, true);
  return credential;
}

function assertSameInvitation(credential: StoredCredential, input: AdmissionInput): void {
  if (
    credential.identityInvitationId !== input.identityInvitationId
    || credential.yoyooInvitationId !== input.yoyooInvitationId
    || credential.clientId !== input.clientId
  ) {
    throw new Error("Existing credential belongs to a different Agent invitation");
  }
}

function summary(credential: StoredCredential): AgentAdmissionSummary {
  if (
    credential.status !== "admitted"
    || !credential.displayName
    || !credential.cardId
    || !credential.connectionStatus
    || !credential.roomIds
  ) {
    throw new Error("Agent admission has not completed");
  }
  return {
    displayName: credential.displayName,
    cardId: credential.cardId,
    machineName: credential.machineName,
    approvalStatus: "admitted",
    connectionStatus: credential.connectionStatus,
    roomIds: credential.roomIds,
  };
}

async function claimIdentity(
  credential: StoredCredential,
  output: string,
  fetcher: typeof fetch,
): Promise<StoredCredential> {
  if (credential.status !== "identity_pending") return credential;
  if (!credential.identityTicket) throw new Error("AI Card invitation ticket is unavailable");
  const privateKey = createPrivateKey({
    key: Buffer.from(credential.privateKeyPkcs8, "base64url"),
    format: "der",
    type: "pkcs8",
  });
  const canonical = [
    "aicard-agent-claim-v1",
    credential.identityInvitationId,
    credential.identityClaimId,
    credential.machineName,
    credential.publicKeySpki,
  ].join("\n");
  const request = {
    invitationId: credential.identityInvitationId,
    ticket: credential.identityTicket,
    claimId: credential.identityClaimId,
    claimSecret: credential.claimSecret,
    machineName: credential.machineName,
    publicKey: credential.publicKeySpki,
    signature: sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("base64url"),
  };
  let raw: unknown;
  try {
    raw = await postJson(
      fetcher,
      `${credential.identityServiceUrl}/api/v1/agent-enrollment/claim`,
      request,
    );
  } catch (claimError) {
    try {
      raw = await postJson(
        fetcher,
        `${credential.identityServiceUrl}/api/v1/agent-enrollment/status`,
        { claimId: credential.identityClaimId, claimSecret: credential.claimSecret },
      );
    } catch {
      throw claimError;
    }
  }
  const claimed = identityResultSchema.parse(raw);
  const updated: StoredCredential = {
    ...credential,
    status: "identity_claimed",
    identityTicket: undefined,
    nodeId: claimed.nodeId,
    cardId: claimed.cardId,
    displayName: claimed.displayName,
    connectionStatus: claimed.connectionStatus,
  };
  await persist(output, updated);
  return updated;
}

async function runtimeToken(
  credential: StoredCredential,
  fetcher: typeof fetch,
): Promise<string> {
  if (!credential.nodeId) throw new Error("AI Card node identity is unavailable");
  const challenge = challengeSchema.parse(await postJson(
    fetcher,
    `${credential.identityServiceUrl}/api/v1/agent-nodes/challenge`,
    { nodeId: credential.nodeId },
  ));
  const privateKey = createPrivateKey({
    key: Buffer.from(credential.privateKeyPkcs8, "base64url"),
    format: "der",
    type: "pkcs8",
  });
  const canonical = [
    "aicard-agent-runtime-v1",
    credential.nodeId,
    credential.clientId,
    challenge.challenge,
  ].join("\n");
  const runtime = runtimeSchema.parse(await postJson(
    fetcher,
    `${credential.identityServiceUrl}/api/v1/agent-nodes/authenticate`,
    {
      nodeId: credential.nodeId,
      clientId: credential.clientId,
      challengeId: challenge.challengeId,
      challenge: challenge.challenge,
      signature: sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("base64url"),
    },
  ));
  if (runtime.nodeId !== credential.nodeId || runtime.runtime.clientId !== credential.clientId) {
    throw new Error("AI Card runtime identity does not match the local credential");
  }
  return runtime.runtime.accessToken;
}

async function declineUnusedIdentity(
  credential: StoredCredential,
  output: string,
  fetcher: typeof fetch,
): Promise<StoredCredential> {
  if (credential.unusedIdentityDeclined !== false) return credential;
  if (!credential.identityTicket) throw new Error("Unused AI Card invitation ticket is unavailable");
  await postJson(
    fetcher,
    `${credential.identityServiceUrl}/api/v1/agent-enrollment/decline`,
    {
      invitationId: credential.identityInvitationId,
      ticket: credential.identityTicket,
    },
  );
  const updated: StoredCredential = {
    ...credential,
    identityTicket: undefined,
    unusedIdentityDeclined: true,
  };
  await persist(output, updated);
  return updated;
}

async function joinYoyoo(
  credential: StoredCredential,
  output: string,
  fetcher: typeof fetch,
): Promise<StoredCredential> {
  if (credential.status === "admitted") return credential;
  if (!credential.yoyooTicket) throw new Error("Yoyoo invitation ticket is unavailable");
  const accessToken = await runtimeToken(credential, fetcher);
  const result = admissionSchema.parse(await postJson(
    fetcher,
    `${credential.yoyooServiceUrl}/api/v1/agent-admissions/claim`,
    {
      invitationId: credential.yoyooInvitationId,
      ticket: credential.yoyooTicket,
      claimId: credential.yoyooClaimId,
    },
    accessToken,
  ));
  if (
    result.admission.invitationId !== credential.yoyooInvitationId
    || result.admission.nodeId !== credential.nodeId
    || result.admission.cardId !== credential.cardId
  ) {
    throw new Error("Yoyoo returned an admission for a different identity");
  }
  const updated: StoredCredential = {
    ...credential,
    status: "admitted",
    yoyooTicket: undefined,
    principalId: result.admission.principalId,
    roomIds: result.admission.roomIds,
    displayName: result.admission.displayName,
    connectionStatus: "connected",
  };
  await persist(output, updated);
  return updated;
}

export async function runAgentAdmissionReference(
  rawInput: unknown,
  rawOutput: string,
  fetcher: typeof fetch = fetch,
  existingIdentityPath?: string,
): Promise<AgentAdmissionSummary> {
  const input = inputSchema.parse(rawInput);
  const output = resolve(rawOutput);
  let credential = await loadCredential(output);
  if (credential) assertSameInvitation(credential, input);
  else if (existingIdentityPath) {
    credential = await reuseCredential(input, output, resolve(existingIdentityPath));
  } else {
    credential = await createCredential(input, output);
  }
  if (credential.status === "admitted") return summary(credential);
  credential = await declineUnusedIdentity(credential, output, fetcher);
  credential = await claimIdentity(credential, output, fetcher);
  credential = await joinYoyoo(credential, output, fetcher);
  return summary(credential);
}

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

async function main(): Promise<void> {
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const identityIndex = process.argv.indexOf("--identity-credential");
  const existingIdentity = identityIndex >= 0 ? process.argv[identityIndex + 1] : undefined;
  const result = await runAgentAdmissionReference(
    JSON.parse(input),
    argument("output"),
    fetch,
    existingIdentity,
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent admission failed";
    process.stderr.write(`Agent admission failed: ${message}\n`);
    process.exitCode = 1;
  }
}
