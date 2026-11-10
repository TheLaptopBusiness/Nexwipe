import { describe, expect, it } from "vitest";
import { KEYBOARD_ROWS, matchFaultyKeys } from "./keyboard-layout";

describe("keyboard layout", () => {
  it("has unique scancode ids (a duplicate would mis-colour the map)", () => {
    const ids = KEYBOARD_ROWS.flat().map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("maps a technician's free text to the right keys", () => {
    const { redIds, unmatched } = matchFaultyKeys("J, Right Shift, Space");
    expect(redIds.has("SC_24")).toBe(true); // J
    expect(redIds.has("SC_36")).toBe(true); // RShift
    expect(redIds.has("SC_39")).toBe(true); // Space
    expect(unmatched).toEqual([]);
  });

  it("distinguishes left/right modifiers and keeps unmatched tokens", () => {
    const { redIds, unmatched } = matchFaultyKeys("left ctrl; fingerprint reader");
    expect(redIds.has("SC_1D")).toBe(true);
    expect(redIds.has("E0_1D")).toBe(false);
    expect(unmatched).toEqual(["fingerprint reader"]);
  });

  it("includes structured flagged ids alongside the text matches", () => {
    const { redIds } = matchFaultyKeys("", ["E0_4B"]);
    expect(redIds.has("E0_4B")).toBe(true);
  });
});
