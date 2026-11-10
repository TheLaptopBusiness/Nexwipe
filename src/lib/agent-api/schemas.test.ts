import { describe, expect, it } from "vitest";
import { DiagnosticResultRequest } from "./schemas";

// Locks the /diagnostics/result request contract the handler relies on. Unknown fields are dropped
// by Zod (the documented footgun), so anything a station sends must be declared here.
describe("DiagnosticResultRequest", () => {
  it("parses a passing keyboard result and drops unknown fields", () => {
    const parsed = DiagnosticResultRequest.parse({
      test: "keyboard",
      outcome: "pass",
      result: { layout: "ansi", keys_registered: ["SC_1E", "SC_30"], note: "all good" },
      detail: "ok",
      hardware_verified: true, // must be dropped, never trusted from a station
    });
    expect(parsed.outcome).toBe("pass");
    expect(parsed.result.keys_registered).toEqual(["SC_1E", "SC_30"]);
    expect(parsed).not.toHaveProperty("hardware_verified");
  });

  it("defaults result to an empty key list when omitted", () => {
    const parsed = DiagnosticResultRequest.parse({ test: "keyboard", outcome: "incomplete" });
    expect(parsed.result.keys_registered).toEqual([]);
  });

  it("rejects an unknown test or outcome", () => {
    expect(DiagnosticResultRequest.safeParse({ test: "display", outcome: "pass" }).success).toBe(
      false,
    );
    expect(DiagnosticResultRequest.safeParse({ test: "keyboard", outcome: "ok" }).success).toBe(
      false,
    );
  });

  it("rejects more than 200 keys", () => {
    const tooMany = Array.from({ length: 201 }, (_, i) => `SC_${i}`);
    expect(
      DiagnosticResultRequest.safeParse({
        test: "keyboard",
        outcome: "pass",
        result: { keys_registered: tooMany },
      }).success,
    ).toBe(false);
  });
});
