import { describe, expect, it } from "vitest";
import { assignableRoles, can, canManageMember } from "./permissions";

describe("role capabilities (UI mirror of database rules)", () => {
  it("technicians cannot manage the team or assign any role", () => {
    expect(can("technician", "team.manage")).toBe(false);
    expect(assignableRoles("technician")).toEqual([]);
  });

  it("administrators cannot grant the owner role or manage an owner", () => {
    expect(assignableRoles("admin")).not.toContain("owner");
    expect(canManageMember("admin", "owner", false)).toBe(false);
  });

  it("nobody can change their own role", () => {
    expect(canManageMember("owner", "owner", true)).toBe(false);
  });

  it("auditors read audit history but cannot write inventory", () => {
    expect(can("auditor", "audit.view")).toBe(true);
    expect(can("auditor", "inventory.write")).toBe(false);
  });

  it("customer viewers cannot see inventory", () => {
    expect(can("customer_viewer", "inventory.view")).toBe(false);
  });
});
