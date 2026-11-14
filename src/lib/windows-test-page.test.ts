import { describe, expect, it } from "vitest";
import page from "../../agent-handoff/windows-helper/nexwipe-test.html?raw";
import { KEYBOARD_ROWS } from "./keyboard-layout";

// The in-Windows test page (served by the helper) must report the same key ids the keyboard map draws.
describe("Windows test page (nexwipe-test.html)", () => {
  it("uses the same keyboard rows and ids as the report's keyboard map", () => {
    const rows = page.slice(
      page.indexOf("const ROWS = ["),
      page.indexOf("];", page.indexOf("const ROWS = [")),
    );
    const pageIds = [...rows.matchAll(/\["[^"]*","([A-Z0-9_]+)","[A-Za-z0-9]+"\]/g)].map(
      (m) => m[1],
    );
    const mapIds = KEYBOARD_ROWS.flat().map((k) => k.id);
    expect(pageIds).toEqual(mapIds);
  });

  it("maps every key to a real KeyboardEvent.code, once", () => {
    const codes = [...page.matchAll(/\["[^"]*","[A-Z0-9_]+","([A-Za-z0-9]+)"\]/g)].map((m) => m[1]);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes)
      expect(c).toMatch(/^(Key[A-Z]|Digit\d|Numpad\w+|F\d{1,2}|Arrow\w+|[A-Z][A-Za-z]+)$/);
  });

  it("only talks to the helper on this laptop", () => {
    expect(page).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
    expect(page).not.toMatch(/<script[^>]+src=/);
  });
});
