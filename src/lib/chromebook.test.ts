import { describe, expect, it } from "vitest";
import { nextStep, resaleBlockers, resetAuthorizationBlockers, MODEL_RESEARCH, type ChromebookState } from "./chromebook";
import { can } from "./permissions";

const allPass = { display: "pass", touchscreen: "not_fitted", keyboard: "pass", touchpad: "pass", battery: "pass", charging: "pass", wifi: "pass", camera: "pass", microphone: "pass", speakers: "pass", ports: "pass", hinges: "pass" };
const ready: ChromebookState = {
  ownership_status: "recorded",
  management_status: "online_setup_checked",
  management_basis: "admin_reported_deprovisioned",
  reset_status: "evidence_collected",
  reset_authorized_by: "u1",
  reset_authorized_at: "2026-10-31T10:00:00Z",
  reset_started_at: "2026-10-31T10:05:00Z",
  reset_completed_at: "2026-10-31T10:20:00Z",
  online_setup_result: "no_enrollment_prompt",
  online_setup_checked_at: "2026-10-31T10:30:00Z",
  diagnostics_status: "passed",
  diagnostics: allPass,
  release_decision: "pending",
  is_synthetic: false,
};

describe("Chromebook rules (UI mirror of the database)", () => {
  it("unknown management blocks resale even after a clean online check", () => {
    expect(resaleBlockers({ ...ready, management_basis: null })).toContain(
      "Management is unknown or unresolved: record an administrator deprovisioning report or the owner's never-managed report",
    );
  });

  it("missing reset authorization or evidence blocks resale", () => {
    expect(resaleBlockers({ ...ready, reset_authorized_by: null })).toContain("Reset authorization by an owner or administrator is missing");
    expect(resaleBlockers({ ...ready, reset_status: "technician_completed" })).toContain("Reset completion evidence is missing");
  });

  it("an online check recorded before the reset finished does not count", () => {
    expect(resaleBlockers({ ...ready, online_setup_checked_at: "2026-10-31T10:10:00Z" })).toContain(
      "The online setup check must happen after the reset was completed",
    );
  });

  it("a failed required diagnostic blocks resale even with a review note", () => {
    expect(resaleBlockers({ ...ready, diagnostics: { ...allPass, display: "fail" } }, "accept anyway")).toContain("Required check not passed: display (fail)");
    expect(resaleBlockers({ ...ready, diagnostics: { ...allPass, keyboard: "not_fitted" } }, "x")).toContain("Required check not passed: keyboard (not_fitted)");
  });

  it("a failed optional diagnostic needs a review note, then is allowed", () => {
    const r = { ...ready, diagnostics: { ...allPass, camera: "fail" } };
    expect(resaleBlockers(r, "")).toContain("Explain the optional diagnostic exceptions in the review notes");
    expect(resaleBlockers(r, "Camera dead, sold as B-grade")).toEqual([]);
  });

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
      "An online setup check after the reset, with no enrollment prompt, is required",
    );
  });

  it("synthetic records can never be resale-ready", () => {
    expect(resaleBlockers({ ...ready, is_synthetic: true })).toContain("Synthetic test records can never be released for resale");
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
