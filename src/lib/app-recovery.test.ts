import { beforeEach, describe, expect, it } from "vitest";
import {
  RETRY_KEY,
  RETRY_WINDOW_MS,
  buildDiagnostics,
  decideRecovery,
  formatDiagnostics,
  hasUnsavedWork,
  installUnsavedWorkTracker,
  isOutdatedCodeError,
  recordManualReload,
  redact,
  resetUnsavedWorkForTests,
} from "./app-recovery";

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const chrome = new TypeError("Failed to fetch dynamically imported module: http://x/src/routes/app.agents.tsx?tsr-split=component");
const safari = new TypeError("Importing a module script failed.");
const firefox = new TypeError("error loading dynamically imported module");

describe("outdated-code recovery", () => {
  it("recognises the three browsers' messages and nothing else", () => {
    expect([chrome, safari, firefox].every(isOutdatedCodeError)).toBe(true);
    expect(isOutdatedCodeError(new Error("Cannot read properties of undefined"))).toBe(false);
  });

  it("reloads exactly once, and the guard (stored before reloading) blocks a second reload", () => {
    const s = new MemStorage();
    const t0 = 1_000_000;
    expect(decideRecovery(chrome, { storage: s, now: t0, hasUnsavedWork: false })).toEqual({ action: "reload" });
    expect(s.getItem(RETRY_KEY)).toBe(String(t0));
    // "after the reload": a fresh page reads the same tab storage and the failure persists
    expect(decideRecovery(chrome, { storage: s, now: t0 + 5_000, hasUnsavedWork: false })).toEqual({ action: "fallback", reason: "already_retried" });
    expect(decideRecovery(safari, { storage: s, now: t0 + RETRY_WINDOW_MS - 1, hasUnsavedWork: false }).action).toBe("fallback");
  });

  it("allows one new automatic reload only after the 5-minute window", () => {
    const s = new MemStorage();
    decideRecovery(chrome, { storage: s, now: 0 + 1, hasUnsavedWork: false });
    expect(decideRecovery(chrome, { storage: s, now: 1 + RETRY_WINDOW_MS, hasUnsavedWork: false }).action).toBe("reload");
  });

  it("asks instead of reloading when a form has unsaved input, without using up the retry", () => {
    const s = new MemStorage();
    expect(decideRecovery(chrome, { storage: s, now: 10, hasUnsavedWork: true })).toEqual({ action: "ask", reason: "unsaved_work" });
    expect(s.getItem(RETRY_KEY)).toBeNull();
  });

  it("a manual reload also arms the guard", () => {
    const s = new MemStorage();
    recordManualReload(s, 50);
    expect(decideRecovery(chrome, { storage: s, now: 60, hasUnsavedWork: false }).action).toBe("fallback");
  });

  it("never auto-reloads when storage is unavailable (no guard = no loop protection)", () => {
    const broken = { getItem: () => null, setItem: () => { throw new Error("blocked"); } };
    expect(decideRecovery(chrome, { storage: broken, now: 1, hasUnsavedWork: false }).action).toBe("fallback");
    expect(decideRecovery(chrome, { storage: null, now: 1, hasUnsavedWork: false }).action).toBe("fallback");
  });

  it("ordinary application errors always get the fallback screen", () => {
    const s = new MemStorage();
    expect(decideRecovery(new Error("boom"), { storage: s, now: 1, hasUnsavedWork: false })).toEqual({ action: "fallback", reason: "not_outdated_code" });
    expect(s.getItem(RETRY_KEY)).toBeNull();
  });
});

describe("unsaved-work tracking", () => {
  beforeEach(() => {
    resetUnsavedWorkForTests();
    document.body.innerHTML = '<form id="f"><input id="i"></form><input id="loose">';
  });

  it("marks typing inside a form as unsaved until submit", () => {
    const off = installUnsavedWorkTracker(document);
    document.getElementById("loose")!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(hasUnsavedWork()).toBe(false);
    document.getElementById("i")!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(hasUnsavedWork()).toBe(true);
    document.getElementById("f")!.dispatchEvent(new Event("submit", { bubbles: true }));
    expect(hasUnsavedWork()).toBe(false);
    off();
  });
});

describe("diagnostics never expose secrets", () => {
  const secrets = [
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "ndagt_9f2c1a7e5b3d4c6e8f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3",
    "ndenr_3f1c9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f",
    "sb_secret_abcdefghijklmnop1234",
    "jane.doe@example.com",
  ];

  it("redacts tokens, keys and email addresses from message, stack and page", () => {
    const err = new Error(`fetch failed Bearer ${secrets[0]} cred=${secrets[1]} enroll ${secrets[2]} key ${secrets[3]} user ${secrets[4]} ?access_token=abc123def456`);
    err.stack = `Error: x\n    at f (http://h/app.tsx?token=${secrets[0]})`;
    const d = buildDiagnostics(err, { pathname: "/invite/0123456789abcdef0123456789abcdef0123456789abcdef" }, new Date(0), "UA");
    const text = formatDiagnostics(d);
    for (const s of secrets) expect(text).not.toContain(s);
    expect(text).not.toContain("abc123def456");
    expect(text).not.toContain("0123456789abcdef0123456789abcdef0123456789abcdef");
    expect(text).toContain("[redacted-jwt]");
    expect(d.kind).toBe("application_error");
  });

  it("keeps useful, non-secret detail", () => {
    const d = buildDiagnostics(new TypeError("Cannot read properties of undefined (reading 'name')"), { pathname: "/app/jobs" });
    expect(d.message).toBe("Cannot read properties of undefined (reading 'name')");
    expect(d.path).toBe("/app/jobs");
    expect(d.id).toMatch(/^[A-Z0-9]{4,}$/);
    expect(redact("plain text")).toBe("plain text");
  });
});
