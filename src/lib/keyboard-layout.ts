// A standard keyboard, row by row, mirroring KEY_ROWS in agent-handoff/station/nd_station/hwtest.py
// (same scancode ids; tests/test_hwtest.py fails if they drift). Used to draw the keyboard map in a
// diagnostic report: ids here must match the ids the station reports in keys_registered.
export type KeyCell = { t: string; id: string; w?: number };

export const KEYBOARD_ROWS: KeyCell[][] = [
  [
    { t: "Esc", id: "SC_01" },
    { t: "F1", id: "SC_3B" },
    { t: "F2", id: "SC_3C" },
    { t: "F3", id: "SC_3D" },
    { t: "F4", id: "SC_3E" },
    { t: "F5", id: "SC_3F" },
    { t: "F6", id: "SC_40" },
    { t: "F7", id: "SC_41" },
    { t: "F8", id: "SC_42" },
    { t: "F9", id: "SC_43" },
    { t: "F10", id: "SC_44" },
    { t: "F11", id: "SC_57" },
    { t: "F12", id: "SC_58" },
  ],
  [
    { t: "`", id: "SC_29" },
    { t: "1", id: "SC_02" },
    { t: "2", id: "SC_03" },
    { t: "3", id: "SC_04" },
    { t: "4", id: "SC_05" },
    { t: "5", id: "SC_06" },
    { t: "6", id: "SC_07" },
    { t: "7", id: "SC_08" },
    { t: "8", id: "SC_09" },
    { t: "9", id: "SC_0A" },
    { t: "0", id: "SC_0B" },
    { t: "-", id: "SC_0C" },
    { t: "=", id: "SC_0D" },
    { t: "Back", id: "SC_0E", w: 64 },
  ],
  [
    { t: "Tab", id: "SC_0F", w: 58 },
    { t: "Q", id: "SC_10" },
    { t: "W", id: "SC_11" },
    { t: "E", id: "SC_12" },
    { t: "R", id: "SC_13" },
    { t: "T", id: "SC_14" },
    { t: "Y", id: "SC_15" },
    { t: "U", id: "SC_16" },
    { t: "I", id: "SC_17" },
    { t: "O", id: "SC_18" },
    { t: "P", id: "SC_19" },
    { t: "[", id: "SC_1A" },
    { t: "]", id: "SC_1B" },
    { t: "\\", id: "SC_2B", w: 46 },
  ],
  [
    { t: "Caps", id: "SC_3A", w: 70 },
    { t: "A", id: "SC_1E" },
    { t: "S", id: "SC_1F" },
    { t: "D", id: "SC_20" },
    { t: "F", id: "SC_21" },
    { t: "G", id: "SC_22" },
    { t: "H", id: "SC_23" },
    { t: "J", id: "SC_24" },
    { t: "K", id: "SC_25" },
    { t: "L", id: "SC_26" },
    { t: ";", id: "SC_27" },
    { t: "'", id: "SC_28" },
    { t: "Enter", id: "SC_1C", w: 76 },
  ],
  [
    { t: "LShift", id: "SC_2A", w: 86 },
    { t: "Z", id: "SC_2C" },
    { t: "X", id: "SC_2D" },
    { t: "C", id: "SC_2E" },
    { t: "V", id: "SC_2F" },
    { t: "B", id: "SC_30" },
    { t: "N", id: "SC_31" },
    { t: "M", id: "SC_32" },
    { t: ",", id: "SC_33" },
    { t: ".", id: "SC_34" },
    { t: "/", id: "SC_35" },
    { t: "RShift", id: "SC_36", w: 90 },
  ],
  [
    { t: "LCtrl", id: "SC_1D", w: 52 },
    { t: "Win", id: "E0_5B", w: 46 },
    { t: "LAlt", id: "SC_38", w: 46 },
    { t: "Space", id: "SC_39", w: 240 },
    { t: "RAlt", id: "E0_38", w: 46 },
    { t: "Menu", id: "E0_5D", w: 46 },
    { t: "RCtrl", id: "E0_1D", w: 52 },
  ],
  [
    { t: "Ins", id: "E0_52" },
    { t: "Del", id: "E0_53" },
    { t: "Home", id: "E0_47", w: 46 },
    { t: "End", id: "E0_4F" },
    { t: "PgUp", id: "E0_49", w: 46 },
    { t: "PgDn", id: "E0_51", w: 46 },
    { t: "PrSc", id: "E0_37" },
    { t: "Left", id: "E0_4B" },
    { t: "Up", id: "E0_48" },
    { t: "Down", id: "E0_50" },
    { t: "Right", id: "E0_4D" },
  ],
  [
    { t: "Num", id: "SC_45" },
    { t: "N/", id: "E0_35" },
    { t: "N*", id: "SC_37" },
    { t: "N-", id: "SC_4A" },
    { t: "N7", id: "SC_47" },
    { t: "N8", id: "SC_48" },
    { t: "N9", id: "SC_49" },
    { t: "N+", id: "SC_4E" },
    { t: "N4", id: "SC_4B" },
    { t: "N5", id: "SC_4C" },
    { t: "N6", id: "SC_4D" },
    { t: "N1", id: "SC_4F" },
    { t: "N2", id: "SC_50" },
    { t: "N3", id: "SC_51" },
    { t: "N0", id: "SC_52" },
    { t: "N.", id: "SC_53" },
    { t: "NEnt", id: "E0_1C", w: 46 },
  ],
];

// Human names a technician might type → scancode id. Single letters/digits/symbols come from the
// layout labels; this adds the multi-word and alternate names.
const SYNONYMS: Record<string, string> = {
  space: "SC_39",
  spacebar: "SC_39",
  enter: "SC_1C",
  return: "SC_1C",
  back: "SC_0E",
  backspace: "SC_0E",
  tab: "SC_0F",
  esc: "SC_01",
  escape: "SC_01",
  caps: "SC_3A",
  capslock: "SC_3A",
  "caps lock": "SC_3A",
  shift: "SC_2A",
  "left shift": "SC_2A",
  lshift: "SC_2A",
  "right shift": "SC_36",
  rshift: "SC_36",
  ctrl: "SC_1D",
  control: "SC_1D",
  "left ctrl": "SC_1D",
  lctrl: "SC_1D",
  "right ctrl": "E0_1D",
  rctrl: "E0_1D",
  alt: "SC_38",
  "left alt": "SC_38",
  lalt: "SC_38",
  "right alt": "E0_38",
  ralt: "E0_38",
  altgr: "E0_38",
  win: "E0_5B",
  windows: "E0_5B",
  menu: "E0_5D",
  up: "E0_48",
  down: "E0_50",
  left: "E0_4B",
  right: "E0_4D",
  "up arrow": "E0_48",
  "down arrow": "E0_50",
  "left arrow": "E0_4B",
  "right arrow": "E0_4D",
  ins: "E0_52",
  insert: "E0_52",
  del: "E0_53",
  delete: "E0_53",
  home: "E0_47",
  end: "E0_4F",
  pgup: "E0_49",
  "page up": "E0_49",
  pgdn: "E0_51",
  "page down": "E0_51",
  prtsc: "E0_37",
  printscreen: "E0_37",
  "print screen": "E0_37",
};

const LABEL_TO_ID: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const row of KEYBOARD_ROWS) for (const k of row) m[k.t.toLowerCase()] = k.id;
  return m;
})();

/**
 * Best-effort mapping of a technician's free-text list of faulty keys (e.g. "J, Right Shift, Space")
 * plus any structured flagged ids, to the scancode cells to light red. Returns the matched ids and
 * the tokens that could not be placed (shown as text so nothing is silently dropped).
 */
export function matchFaultyKeys(
  text: string | null | undefined,
  flaggedIds: string[] = [],
): { redIds: Set<string>; unmatched: string[] } {
  const redIds = new Set<string>(flaggedIds);
  const unmatched: string[] = [];
  for (const raw of (text ?? "").split(/[,;\n]+/)) {
    const token = raw.trim().toLowerCase();
    if (!token) continue;
    const id =
      SYNONYMS[token] ??
      LABEL_TO_ID[token] ??
      (/^f([1-9]|1[0-2])$/.test(token) ? LABEL_TO_ID[token] : undefined);
    if (id) redIds.add(id);
    else unmatched.push(raw.trim());
  }
  return { redIds, unmatched };
}
