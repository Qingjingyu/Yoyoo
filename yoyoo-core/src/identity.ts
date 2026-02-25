export type Role = "admin" | "member";

export interface ResolveRoleInput {
  senderId: string;
  admins?: string[];
}

export interface CommandPermissionInput {
  role: Role;
  command: string;
}

export function resolveRole(input: ResolveRoleInput): Role {
  const sender = input.senderId.trim().toLowerCase();
  const admins = (input.admins ?? []).map((id) => id.trim().toLowerCase());
  return admins.includes(sender) ? "admin" : "member";
}

export function canExecuteCommand(input: CommandPermissionInput): boolean {
  const cmd = input.command.trim().toLowerCase();
  const isAdminOnly =
    cmd.startsWith("/admin") || cmd.startsWith("/policy") || cmd.startsWith("/bridge") || cmd.startsWith("/dmreply");

  if (!isAdminOnly) {
    return true;
  }

  return input.role === "admin";
}
