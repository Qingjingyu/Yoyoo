import { describe, expect, it } from "vitest";
import { canExecuteCommand, resolveRole } from "../src/identity";

describe("identity policy", () => {
  it("marks sender as admin when in admin list", () => {
    const role = resolveRole({ senderId: "u-admin", admins: ["u-admin"] });
    expect(role).toBe("admin");
  });

  it("marks sender as member by default", () => {
    const role = resolveRole({ senderId: "u-member", admins: ["u-admin"] });
    expect(role).toBe("member");
  });

  it("allows admin-only commands for admin", () => {
    const allowed = canExecuteCommand({
      role: "admin",
      command: "/admin status",
    });
    expect(allowed).toBe(true);
  });

  it("blocks admin-only commands for member", () => {
    const allowed = canExecuteCommand({
      role: "member",
      command: "/admin status",
    });
    expect(allowed).toBe(false);
  });

  it("allows normal commands for member", () => {
    const allowed = canExecuteCommand({
      role: "member",
      command: "/help",
    });
    expect(allowed).toBe(true);
  });
});
