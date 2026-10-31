import { describe, expect, it } from "vitest";
import { needsFirstPassword, skipFirstPasswordRedirect } from "./first-password";

describe("first password for invited accounts", () => {
  it("an account created by an invitation must set a password first", () => {
    expect(needsFirstPassword({ invited_at: "2026-10-31T09:37:10Z", user_metadata: {} })).toBe(true);
  });
  it("once the password is set, no more prompt", () => {
    expect(needsFirstPassword({ invited_at: "2026-10-31T09:37:10Z", user_metadata: { password_set: true } })).toBe(false);
  });
  it("existing (non-invited) accounts are never prompted", () => {
    expect(needsFirstPassword({ invited_at: null, user_metadata: {} })).toBe(false);
    expect(needsFirstPassword(null)).toBe(false);
  });
  it("the invite, welcome and reset pages are not redirected", () => {
    expect(skipFirstPasswordRedirect("/invite/abc")).toBe(true);
    expect(skipFirstPasswordRedirect("/welcome")).toBe(true);
    expect(skipFirstPasswordRedirect("/app")).toBe(false);
    expect(skipFirstPasswordRedirect("/")).toBe(false);
  });
});
