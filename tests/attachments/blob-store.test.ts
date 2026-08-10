/** @vitest-environment node */

import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BlobAlreadyExistsError,
  BlobLimitExceededError,
  InvalidObjectKeyError,
  LocalBlobStore,
} from "@/server/local-blob-store";

describe("LocalBlobStore", () => {
  let root = "";
  let store: LocalBlobStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "yoyoo-blob-store-"));
    store = new LocalBlobStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("streams a private object and returns authoritative size and digest", async () => {
    const bytes = Buffer.from("Yoyoo private attachment", "utf8");

    const result = await store.write({
      objectKey: "ab/abcdef0123456789",
      source: Readable.from([bytes.subarray(0, 7), bytes.subarray(7)]),
      maxBytes: 1024,
    });

    expect(result).toEqual({
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    await expect(store.stat("ab/abcdef0123456789")).resolves.toEqual({
      sizeBytes: bytes.byteLength,
    });

    const read = await store.open("ab/abcdef0123456789");
    const chunks: Buffer[] = [];
    for await (const chunk of read.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(bytes);
    expect(read).toMatchObject({
      sizeBytes: bytes.byteLength,
      start: 0,
      end: bytes.byteLength - 1,
      partial: false,
    });
  });

  it("returns a bounded inclusive byte range", async () => {
    await store.write({
      objectKey: "cd/cdef0123456789ab",
      source: Readable.from([Buffer.from("0123456789", "utf8")]),
      maxBytes: 10,
    });

    const read = await store.open("cd/cdef0123456789ab", { start: 2, end: 5 });
    const chunks: Buffer[] = [];
    for await (const chunk of read.stream) chunks.push(Buffer.from(chunk));

    expect(Buffer.concat(chunks).toString("utf8")).toBe("2345");
    expect(read).toMatchObject({
      sizeBytes: 10,
      start: 2,
      end: 5,
      partial: true,
    });
  });

  it("rejects traversal and absolute object keys before filesystem access", async () => {
    for (const objectKey of ["../secret", "/tmp/secret", "aa/../../secret", "short"]) {
      await expect(
        store.write({
          objectKey,
          source: Readable.from([Buffer.from("x")]),
          maxBytes: 1,
        }),
      ).rejects.toBeInstanceOf(InvalidObjectKeyError);
    }

    await expect(readdir(root)).resolves.toEqual([]);
  });

  it("removes temporary data when the stream exceeds its limit", async () => {
    await expect(
      store.write({
        objectKey: "ef/ef0123456789abcd",
        source: Readable.from([Buffer.alloc(4), Buffer.alloc(5)]),
        maxBytes: 8,
      }),
    ).rejects.toBeInstanceOf(BlobLimitExceededError);

    await expect(store.stat("ef/ef0123456789abcd")).resolves.toBeNull();
    await expect(readdir(join(root, "ef"))).resolves.toEqual([]);
  });

  it("deletes an existing object idempotently", async () => {
    await store.write({
      objectKey: "01/0123456789abcdef",
      source: Readable.from([Buffer.from("delete me")]),
      maxBytes: 20,
    });

    await store.delete("01/0123456789abcdef");
    await store.delete("01/0123456789abcdef");

    await expect(store.stat("01/0123456789abcdef")).resolves.toBeNull();
  });

  it("never replaces or deletes an existing object on a duplicate write", async () => {
    const objectKey = "23/23456789abcdef01";
    await store.write({
      objectKey,
      source: Readable.from([Buffer.from("original")]),
      maxBytes: 20,
    });

    await expect(
      store.write({
        objectKey,
        source: Readable.from([Buffer.from("replacement")]),
        maxBytes: 20,
      }),
    ).rejects.toBeInstanceOf(BlobAlreadyExistsError);

    const read = await store.open(objectKey);
    const chunks: Buffer[] = [];
    for await (const chunk of read.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString("utf8")).toBe("original");
  });
});
