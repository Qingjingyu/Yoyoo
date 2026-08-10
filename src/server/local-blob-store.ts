import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  type FileHandle,
  link,
  mkdir,
  open,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";

import {
  BlobAlreadyExistsError,
  BlobLimitExceededError,
  BlobRangeNotSatisfiableError,
  type BlobReadRange,
  type BlobReadResult,
  type BlobStatResult,
  type BlobStore,
  type BlobWriteInput,
  type BlobWriteResult,
  InvalidObjectKeyError,
} from "@/server/blob-store";

export {
  BlobAlreadyExistsError,
  BlobLimitExceededError,
  BlobRangeNotSatisfiableError,
  InvalidObjectKeyError,
} from "@/server/blob-store";

const objectKeyPattern = /^[a-z0-9][a-z0-9/_-]{15,239}$/;

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function resolveObjectPath(root: string, objectKey: string): string {
  const segments = objectKey.split("/");
  if (
    !objectKeyPattern.test(objectKey) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new InvalidObjectKeyError();
  }

  const resolved = resolve(root, ...segments);
  if (!resolved.startsWith(`${root}${sep}`)) throw new InvalidObjectKeyError();
  return resolved;
}

async function writeChunk(handle: FileHandle, chunk: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const result = await handle.write(chunk, offset, chunk.byteLength - offset);
    offset += result.bytesWritten;
  }
}

export class LocalBlobStore implements BlobStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async write(input: BlobWriteInput): Promise<BlobWriteResult> {
    if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0) {
      throw new RangeError("maxBytes must be a positive safe integer");
    }

    const destination = resolveObjectPath(this.root, input.objectKey);
    const directory = dirname(destination);
    const temporary = resolve(
      directory,
      `.${basename(destination)}.part-${randomUUID()}`,
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });

    let handle: FileHandle | null = null;
    try {
      handle = await open(temporary, "wx", 0o600);
      const digest = createHash("sha256");
      let sizeBytes = 0;

      for await (const value of input.source) {
        const chunk = Buffer.from(value);
        if (chunk.byteLength === 0) continue;
        sizeBytes += chunk.byteLength;
        if (sizeBytes > input.maxBytes) {
          throw new BlobLimitExceededError(input.maxBytes);
        }
        digest.update(chunk);
        await writeChunk(handle, chunk);
      }

      if (sizeBytes === 0) throw new RangeError("Blob must contain at least one byte");
      await handle.sync();
      await handle.close();
      handle = null;

      try {
        await link(temporary, destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new BlobAlreadyExistsError();
        }
        throw error;
      }
      return { sizeBytes, sha256: digest.digest("hex") };
    } finally {
      await handle?.close().catch(() => undefined);
      await unlink(temporary).catch((error: unknown) => {
        if (!isMissing(error)) throw error;
      });
    }
  }

  async open(
    objectKey: string,
    range: Partial<BlobReadRange> = {},
  ): Promise<BlobReadResult> {
    const path = resolveObjectPath(this.root, objectKey);
    const metadata = await stat(path);
    const sizeBytes = metadata.size;
    const start = range.start ?? 0;
    const end = range.end ?? sizeBytes - 1;

    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end >= sizeBytes
    ) {
      throw new BlobRangeNotSatisfiableError(sizeBytes);
    }

    return {
      stream: createReadStream(path, { start, end }),
      sizeBytes,
      start,
      end,
      partial: start !== 0 || end !== sizeBytes - 1,
    };
  }

  async stat(objectKey: string): Promise<BlobStatResult | null> {
    const path = resolveObjectPath(this.root, objectKey);
    try {
      const metadata = await stat(path);
      return { sizeBytes: metadata.size };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async delete(objectKey: string): Promise<void> {
    const path = resolveObjectPath(this.root, objectKey);
    await unlink(path).catch((error: unknown) => {
      if (!isMissing(error)) throw error;
    });
  }
}
