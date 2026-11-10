import { describe, expect, it } from "vitest";
import { DiagnosticResultRequest, KEYBOARD_PASS_MIN_KEYS } from "./schemas";

const keys = (n: number) => Array.from({ length: n }, (_, i) => `SC_${i.toString(16)}`);

// Locks the /diagnostics/result request contract the handler relies on. Unknown fields are dropped
// by Zod (the documented footgun), so anything a station sends must be declared here.
describe("DiagnosticResultRequest", () => {
  it("parses a passing keyboard result and drops unknown fields", () => {
    const parsed = DiagnosticResultRequest.parse({
      test: "keyboard",
      outcome: "pass",
      result: { layout: "ansi", keys_registered: keys(KEYBOARD_PASS_MIN_KEYS), note: "all good" },
      detail: "ok",
      hardware_verified: true, // must be dropped, never trusted from a station
    });
    expect(parsed.outcome).toBe("pass");
    expect(parsed.result.keys_registered).toHaveLength(KEYBOARD_PASS_MIN_KEYS);
    expect(parsed).not.toHaveProperty("hardware_verified");
  });

  it("rejects a pass that registered too few keys, but allows incomplete/fail", () => {
    const few = { result: { keys_registered: keys(3) } };
    expect(
      DiagnosticResultRequest.safeParse({ test: "keyboard", outcome: "pass", ...few }).success,
    ).toBe(false);
    expect(
      DiagnosticResultRequest.safeParse({ test: "keyboard", outcome: "incomplete", ...few })
        .success,
    ).toBe(true);
    expect(
      DiagnosticResultRequest.safeParse({ test: "keyboard", outcome: "fail", ...few }).success,
    ).toBe(true);
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
