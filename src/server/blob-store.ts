import type { Readable } from "node:stream";

export interface BlobWriteInput {
  objectKey: string;
  source: AsyncIterable<Uint8Array>;
  maxBytes: number;
}

export interface BlobWriteResult {
  sizeBytes: number;
  sha256: string;
}

export interface BlobReadRange {
  start: number;
  end: number;
}

export interface BlobReadResult extends BlobReadRange {
  stream: Readable;
  sizeBytes: number;
  partial: boolean;
}

export interface BlobStatResult {
  sizeBytes: number;
}

export interface BlobStore {
  write(input: BlobWriteInput): Promise<BlobWriteResult>;
  open(objectKey: string, range?: Partial<BlobReadRange>): Promise<BlobReadResult>;
  stat(objectKey: string): Promise<BlobStatResult | null>;
  delete(objectKey: string): Promise<void>;
}

export class InvalidObjectKeyError extends Error {
  constructor() {
    super("Object key is invalid");
    this.name = "InvalidObjectKeyError";
  }
}

export class BlobLimitExceededError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Blob exceeds the ${maxBytes} byte limit`);
    this.name = "BlobLimitExceededError";
  }
}

export class BlobRangeNotSatisfiableError extends Error {
  constructor(readonly sizeBytes: number) {
    super("Requested blob range is not satisfiable");
    this.name = "BlobRangeNotSatisfiableError";
  }
}

export class BlobAlreadyExistsError extends Error {
  constructor() {
    super("Object key already exists");
    this.name = "BlobAlreadyExistsError";
  }
}
