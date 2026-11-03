// UI-side capability matrix. This only decides which controls to show.
// Every rule here is ALSO enforced by database row-level security and RPC checks;
// hiding a button is never the security boundary.

export type OrgRole = "owner" | "admin" | "technician" | "auditor" | "customer_viewer";

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Organization owner",
  admin: "Administrator",
  technician: "Technician",
  auditor: "Auditor",
  customer_viewer: "Customer viewer",
};

export const ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
  owner: "Account ownership, billing and all settings.",
  admin: "Users, sites, clients, policies and operations.",
  technician: "Inventory intake and authorized job operation.",
  auditor: "Read-only access to evidence, records and audit history.",
  customer_viewer: "Only explicitly assigned client projects and approved reports.",
};

export type Capability =
  | "org.settings"
  | "team.manage"
  | "team.view"
  | "sites.manage"
  | "clients.manage"
  | "projects.manage"
  | "batches.manage"
  | "inventory.view"
  | "inventory.write"
  | "inventory.delete"
  | "audit.view"
  | "policies.manage"
  | "jobs.view"
  | "jobs.operate"
  | "agents.view"
  | "agents.manage"
  | "stations.act"
  | "simulator.run"
  | "chromebooks.view"
  | "chromebooks.operate"
  | "chromebooks.authorize";

const MATRIX: Record<Capability, OrgRole[]> = {
  "org.settings": ["owner", "admin"],
  "team.manage": ["owner", "admin"],
  "team.view": ["owner", "admin", "technician", "auditor"],
  "sites.manage": ["owner", "admin"],
  "clients.manage": ["owner", "admin"],
  "projects.manage": ["owner", "admin"],
  "batches.manage": ["owner", "admin", "technician"],
  "inventory.view": ["owner", "admin", "technician", "auditor"],
  "inventory.write": ["owner", "admin", "technician"],
  "inventory.delete": ["owner", "admin"],
  "audit.view": ["owner", "admin", "auditor"],
  "policies.manage": ["owner", "admin"],
  "jobs.view": ["owner", "admin", "technician", "auditor"],
  "jobs.operate": ["owner", "admin", "technician"],
  "agents.view": ["owner", "admin", "technician", "auditor"],
  "agents.manage": ["owner", "admin"],
  // Mirrors request_station_action: Rescan / Reboot into NexWipe. Auditors only watch.
  "stations.act": ["owner", "admin", "technician"],
  "simulator.run": ["owner", "admin", "technician"],
  // Mirrors chromebook_* RPCs: technicians run the workflow; reset authorization and release need owner/admin.
  "chromebooks.view": ["owner", "admin", "technician", "auditor"],
  "chromebooks.operate": ["owner", "admin", "technician"],
  "chromebooks.authorize": ["owner", "admin"],
};

export function can(role: OrgRole | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return MATRIX[capability].includes(role);
}

/** Roles the acting user may assign to someone else. Mirrors update_member_role / create_invitation. */
export function assignableRoles(actor: OrgRole | null | undefined): OrgRole[] {
  if (actor === "owner") return ["owner", "admin", "technician", "auditor", "customer_viewer"];
  if (actor === "admin") return ["admin", "technician", "auditor", "customer_viewer"];
  return [];
}

/** Whether the actor may change the role of / remove a member currently holding `target`. */
export function canManageMember(
  actor: OrgRole | null | undefined,
  target: OrgRole,
  isSelf: boolean,
): boolean {
  if (isSelf) return false;
  if (actor === "owner") return true;
  if (actor === "admin") return target !== "owner";
  return false;
}

export function isPrivileged(role: OrgRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}
