import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

import { z } from 'zod';

const SESSION_TTL_MS = 10 * 60 * 1_000;
const sessionSchema = z.object({
  state: z.string().regex(/^[A-Za-z0-9._~-]{16,256}$/),
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{22,128}$/),
  purpose: z.enum(['owner', 'agent']),
  createdAt: z.number().int().nonnegative(),
}).strict();

export type AICardAuthorizationSession = z.infer<typeof sessionSchema>;

export class AICardAuthorizationSessionError extends Error {
  constructor(message = 'AI Card authorization session is invalid') {
    super(message);
    this.name = 'AICardAuthorizationSessionError';
  }
}

function parseSecret(secret: string): Buffer {
  const key = Buffer.from(secret, 'base64url');
  if (key.length !== 32 || key.toString('base64url') !== secret) {
    throw new AICardAuthorizationSessionError(
      'AI Card authorization requires a canonical 256-bit server secret',
    );
  }
  return key;
}

function decodePart(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64url');
  if (!value || decoded.toString('base64url') !== value) {
    throw new AICardAuthorizationSessionError();
  }
  return decoded;
}

export function sealAICardAuthorizationSession(
  input: AICardAuthorizationSession,
  secret: string,
): string {
  const session = sessionSchema.parse(input);
  const key = parseSecret(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('yoyoo:aicard:authorization:v1', 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(session), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), ciphertext.toString('base64url'), tag.toString('base64url')]
    .join('.');
}

export function openAICardAuthorizationSession(
  sealed: string,
  secret: string,
  now = new Date(),
): AICardAuthorizationSession {
  try {
    const [version, ivPart, ciphertextPart, tagPart, extra] = sealed.split('.');
    if (version !== 'v1' || !ivPart || !ciphertextPart || !tagPart || extra) {
      throw new AICardAuthorizationSessionError();
    }
    const key = parseSecret(secret);
    const iv = decodePart(ivPart);
    const ciphertext = decodePart(ciphertextPart);
    const tag = decodePart(tagPart);
    if (iv.length !== 12 || tag.length !== 16) {
      throw new AICardAuthorizationSessionError();
    }
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from('yoyoo:aicard:authorization:v1', 'utf8'));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
    const session = sessionSchema.parse(JSON.parse(plaintext));
    const age = now.getTime() - session.createdAt;
    if (age < 0 || age > SESSION_TTL_MS) {
      throw new AICardAuthorizationSessionError(
        'AI Card authorization session has expired',
      );
    }
    return session;
  } catch (error) {
    if (error instanceof AICardAuthorizationSessionError) throw error;
    throw new AICardAuthorizationSessionError();
  }
}
