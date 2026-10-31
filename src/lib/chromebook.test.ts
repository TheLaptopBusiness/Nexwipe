import { describe, expect, it } from "vitest";
import { nextStep, resaleBlockers, resetAuthorizationBlockers, MODEL_RESEARCH, type ChromebookState } from "./chromebook";
import { can } from "./permissions";

const ready: ChromebookState = {
  ownership_status: "recorded",
  management_status: "online_setup_checked",
  reset_status: "technician_completed",
  online_setup_result: "no_enrollment_prompt",
  diagnostics_status: "passed",
  release_decision: "pending",
  is_synthetic: false,
};

describe("Chromebook rules (UI mirror of the database)", () => {
  it("allows resale-ready only when every requirement is met", () => {
    expect(resaleBlockers(ready)).toEqual([]);
  });

  it("managed or unresolved devices cannot be resale-ready", () => {
    for (const m of ["unknown", "management_observed", "deprovision_requested", "admin_reported_deprovisioned", "blocked"]) {
      expect(resaleBlockers({ ...ready, management_status: m }).length).toBeGreaterThan(0);
    }
  });

  it("a completed reset alone does not clear management", () => {
    expect(resaleBlockers({ ...ready, management_status: "unknown", online_setup_result: "not_checked" })).toContain(
      "Needs an online setup check after reset showing no enrollment prompt.",
    );
  });

  it("synthetic records can never be resale-ready", () => {
    expect(resaleBlockers({ ...ready, is_synthetic: true })).toContain("Synthetic test records can never be released for resale.");
  });

  it("reset cannot be authorized while management is observed or deprovisioning is pending", () => {
    const base = { ...ready, reset_status: "not_started", management_status: "management_observed" };
    expect(resetAuthorizationBlockers(base).length).toBe(1);
    expect(resetAuthorizationBlockers({ ...base, management_status: "deprovision_requested" }).length).toBe(1);
    expect(resetAuthorizationBlockers({ ...base, management_status: "admin_reported_deprovisioned" })).toEqual([]);
  });

  it("reset needs ownership authorization first", () => {
    expect(resetAuthorizationBlockers({ ...ready, reset_status: "not_started", management_status: "unknown", ownership_status: "not_recorded" })).toContain(
      "Record ownership / processing authorization first.",
    );
  });

  it("guides an interrupted reset back to authorization", () => {
    expect(nextStep({ ...ready, reset_status: "failed_interrupted", management_status: "unknown", online_setup_result: "not_checked" })).toBe(
      "Authorize the reset (owner or administrator).",
    );
  });

  it("only owners and admins may authorize resets or release; technicians operate; auditors read", () => {
    expect(can("technician", "chromebooks.authorize")).toBe(false);
    expect(can("admin", "chromebooks.authorize")).toBe(true);
    expect(can("technician", "chromebooks.operate")).toBe(true);
    expect(can("auditor", "chromebooks.operate")).toBe(false);
    expect(can("customer_viewer", "chromebooks.view")).toBe(false);
  });

  it("does not claim a board for models that are not confirmed", () => {
    for (const m of MODEL_RESEARCH.filter((x) => x.boardStatus !== "identified")) expect(m.board).toBe("Unconfirmed");
  });
});
