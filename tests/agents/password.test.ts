import { describe, expect, it } from "vitest";

import {
  hashPassword,
  normalizeLoginHandle,
  verifyPassword,
} from "@/server/auth/password";

describe("human password credentials", () => {
  it("normalizes a human login handle without accepting ambiguous input", () => {
    expect(normalizeLoginHandle("@SuBai")).toBe("subai");
    expect(() => normalizeLoginHandle(" su bai ")).toThrow("登录账号");
    expect(() => normalizeLoginHandle("ab")).toThrow("登录账号");
  });

  it("hashes and verifies a password without retaining plaintext", async () => {
    const credential = await hashPassword("A-secure-password-2026");

    expect(credential.algorithm).toBe("scrypt-v1");
    expect(credential.hash).toHaveLength(64);
    expect(credential.salt).toHaveLength(16);
    expect(credential.hash.toString("utf8")).not.toContain("secure-password");
    await expect(
      verifyPassword("A-secure-password-2026", credential),
    ).resolves.toBe(true);
    await expect(verifyPassword("wrong-password-2026", credential)).resolves.toBe(false);
  });

  it("rejects weak, oversized, and whitespace-ambiguous passwords", async () => {
    await expect(hashPassword("too-short")).rejects.toThrow("密码");
    await expect(hashPassword(` ${"a".repeat(20)}`)).rejects.toThrow("密码");
    await expect(hashPassword("a".repeat(129))).rejects.toThrow("密码");
  });
});
