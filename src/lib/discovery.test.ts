import { describe, expect, it } from "vitest";
import { summarizeDiscovery } from "./discovery";

describe("station discovery display", () => {
  it("marks the station boot medium as not recorded", () => {
    const s = summarizeDiscovery({ drives: [{ serial: "USB1", removable: true, is_boot_medium: true }, { serial: "NVME1", interface: "nvme_ssd" }] });
    expect(s.drives.map((d) => d.ignored)).toEqual([true, false]);
  });
  it("treats unknown interfaces as unsupported", () => {
    expect(summarizeDiscovery({ drives: [{ serial: "X", interface: "emmc" }] }).drives[0]!.interfaceLabel).toBe("Unsupported / other");
  });
  it("caps reported drives at 16", () => {
    const drives = Array.from({ length: 20 }, (_, i) => ({ serial: `D${i}` }));
    expect(summarizeDiscovery({ drives }).drives).toHaveLength(16);
  });
});

describe("review flags", () => {
  it("labels known codes and removes duplicates from repeated reports", async () => {
    const { reviewFlags } = await import("./discovery");
    const f = reviewFlags([{ code: "duplicate_drive_serial" }, { code: "duplicate_drive_serial" }, { code: "drive_serial_missing", target: "pci-0000:02:00.0-nvme-1" }]);
    expect(f.map((x) => x.label)).toEqual(["Two drives report the same serial number", "Drive serial number missing"]);
  });
  it("ignores malformed flags from a station", async () => {
    const { reviewFlags } = await import("./discovery");
    expect(reviewFlags([{ code: "<script>" }, null, "x"])).toEqual([]);
  });
});
