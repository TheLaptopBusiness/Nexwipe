import { describe, expect, it } from "vitest";
import { canTransition, deviceClearance, heartbeatState, methodFitsInterface } from "./jobs";
import { eventPayload, parseTimestampHeader, statusForDbCode } from "./agent-api/schemas";

describe("job state machine (UI mirror)", () => {
  it("never allows approval except from awaiting validation", () => {
    expect(canTransition("awaiting_validation", "approved")).toBe(true);
    expect(canTransition("running", "approved")).toBe(false);
    expect(canTransition("verifying", "approved")).toBe(false);
    expect(canTransition("interrupted", "approved")).toBe(false);
  });

  it("an interrupted job can never jump straight to awaiting validation", () => {
    expect(canTransition("interrupted", "awaiting_validation")).toBe(false);
  });

  it("closed jobs cannot move", () => {
    expect(canTransition("approved", "quarantined")).toBe(false);
    expect(canTransition("cancelled", "queued")).toBe(false);
  });

  it("jobs cannot be cancelled once running", () => {
    expect(canTransition("queued", "cancelled")).toBe(true);
    expect(canTransition("running", "cancelled")).toBe(false);
  });
});

describe("multi-drive laptop clearance", () => {
  const drives = [
    { associationId: "a1", serial: "S1" },
    { associationId: "a2", serial: "S2" },
  ];
  it("one failed drive keeps the laptop from being ready", () => {
    const r = deviceClearance(drives, [
      { associationId: "a1", status: "approved", createdAt: "2026-01-01" },
      { associationId: "a2", status: "quarantined", createdAt: "2026-01-01" },
    ]);
    expect(r.ready).toBe(false);
    expect(r.blocking.map((b) => b.serial)).toEqual(["S2"]);
  });
  it("an unverified drive (awaiting validation) keeps the laptop from being ready", () => {
    const r = deviceClearance(drives, [
      { associationId: "a1", status: "approved", createdAt: "2026-01-01" },
      { associationId: "a2", status: "awaiting_validation", createdAt: "2026-01-01" },
    ]);
    expect(r.ready).toBe(false);
  });
  it("a drive with no job keeps the laptop from being ready", () => {
    const r = deviceClearance(drives, [{ associationId: "a1", status: "approved", createdAt: "2026-01-01" }]);
    expect(r.ready).toBe(false);
  });
  it("the latest job counts, ignoring cancelled ones", () => {
    const r = deviceClearance(drives, [
      { associationId: "a1", status: "approved", createdAt: "2026-01-01" },
      { associationId: "a2", status: "quarantined", createdAt: "2026-01-01" },
      { associationId: "a2", status: "approved", createdAt: "2026-01-02" },
      { associationId: "a2", status: "cancelled", createdAt: "2026-01-03" },
    ]);
    expect(r.ready).toBe(true);
  });
  it("a laptop with no drives is never ready through erasure", () => {
    expect(deviceClearance([], []).ready).toBe(false);
  });
});

describe("method / interface compatibility", () => {
  it("overwrite is never permitted for SSDs", () => {
    expect(methodFitsInterface("overwrite_single_pass", "sata_ssd")).toBe(false);
    expect(methodFitsInterface("overwrite_single_pass", "nvme_ssd")).toBe(false);
    expect(methodFitsInterface("overwrite_single_pass", "sata_hdd")).toBe(true);
  });
});

describe("agent heartbeat", () => {
  const now = Date.parse("2026-10-31T00:10:00Z");
  it("is offline after 3 minutes without a heartbeat", () => {
    expect(heartbeatState("2026-10-31T00:06:59Z", now)).toBe("offline");
    expect(heartbeatState("2026-10-31T00:09:30Z", now)).toBe("online");
    expect(heartbeatState(null, now)).toBe("never");
  });
});

describe("agent API helpers", () => {
  it("maps database rejections to HTTP statuses", () => {
    expect(statusForDbCode("ND401")).toBe(401);
    expect(statusForDbCode("ND409")).toBe(409);
    expect(statusForDbCode("ND422")).toBe(422);
    expect(statusForDbCode("XX000")).toBe(500);
  });
  it("accepts ISO and unix-second timestamps", () => {
    expect(parseTimestampHeader("1793404800")?.toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(parseTimestampHeader("2026-10-31T00:00:00Z")?.toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(parseTimestampHeader("nope")).toBeNull();
  });
  it("strips transport fields from stored event payloads", () => {
    expect(eventPayload({ seq: 3, idempotency_key: "k", type: "progress", phase: "x" })).toEqual({ phase: "x" });
  });
});
