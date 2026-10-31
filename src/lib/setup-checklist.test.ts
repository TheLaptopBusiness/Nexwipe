import { describe, expect, it } from "vitest";
import { setupProgress } from "./setup-checklist";
import { looksAutomated, signupSchema } from "@/routes/signup";

describe("setup checklist", () => {
  it("a new organization has 2 of 4 steps done", () => {
    expect(setupProgress({ sites: 0, realStations: 0, devices: 0 })).toMatchObject({ done: 2, total: 4, complete: false });
  });
  it("adding a site and a real device completes setup", () => {
    expect(setupProgress({ sites: 1, realStations: 1, devices: 1 }).complete).toBe(true);
  });
  it("a station alone does not complete the device step", () => {
    expect(setupProgress({ sites: 1, realStations: 1, devices: 0 })).toMatchObject({ station: true, device: false, complete: false });
  });
});

describe("signup form rules", () => {
  const ok = { fullName: "Ana Ruiz", email: "Ana@Example.com", password: "correct horse 9" };
  it("accepts name, email and a 10+ character password with a number", () => {
    const r = signupSchema.safeParse(ok);
    expect(r.success && r.data.email).toBe("ana@example.com");
  });
  it("rejects passwords shorter than 10 characters or without a number", () => {
    expect(signupSchema.safeParse({ ...ok, password: "short1" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...ok, password: "nonumbershere" }).success).toBe(false);
  });
  it("rejects a missing name", () => {
    expect(signupSchema.safeParse({ ...ok, fullName: " " }).success).toBe(false);
  });
  it("treats a filled honeypot or a sub-2.5-second submit as automated", () => {
    expect(looksAutomated("http://spam", 0, 10_000)).toBe(true);
    expect(looksAutomated("", 1_000, 2_000)).toBe(true);
    expect(looksAutomated("", 0, 10_000)).toBe(false);
  });
});

import { landingAction } from "./landing-hash";
describe("verification link landing", () => {
  it("continues sign-up for a verified-email link", () => {
    expect(landingAction("#access_token=abc&type=signup").kind).toBe("continue_signup");
  });
  it("reports an expired link instead of signing in", () => {
    const a = landingAction("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid");
    expect(a.kind).toBe("link_error");
  });
  it("ignores ordinary anchors and password-recovery links", () => {
    expect(landingAction("#pricing").kind).toBe("none");
    expect(landingAction("#access_token=abc&type=recovery").kind).toBe("none");
  });
});
