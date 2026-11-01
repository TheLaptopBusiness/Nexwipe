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

import { summarizeCapabilities } from "./discovery";
import { InventoryRequest } from "./agent-api/schemas";
describe("drive capabilities from a station", () => {
  it("lists NVMe features the drive advertises", () => {
    const c = summarizeCapabilities({ source: "nvme_identify_controller", nvme_format_nvm: { supported: true, crypto_erase: true }, nvme_sanitize_feature: { supported: true, crypto_erase: true, block_erase: true, overwrite: false } });
    expect(c?.advertised).toEqual(["NVMe Sanitize (crypto erase, block erase)", "NVMe Format (user-data erase + crypto erase)"]);
  });
  it("notes a frozen SATA drive", () => {
    const c = summarizeCapabilities({ source: "ata_identify_sysfs", ata_security: { supported: true, frozen: true }, ata_sanitize_feature: { supported: false } });
    expect(c?.notes).toContain("Security commands frozen by firmware at boot");
  });
  it("keeps unreadable capabilities unknown", () => {
    expect(summarizeCapabilities({ source: "unavailable", reason: "permission denied" })?.unknown).toBe("Capabilities unknown (permission denied)");
  });
});

describe("station inventory contract", () => {
  const base = { system: { serial: "S1" }, drives: [] };
  it("keeps the station's hardware-source declaration", () => {
    const r = InventoryRequest.parse({ ...base, station: { mode: "read_only", hardware_source: "physical", hardware_source_reason: "no virtualisation detected" } });
    expect(r.station?.hardware_source).toBe("physical");
  });
  it("rejects an unknown hardware-source value", () => {
    expect(InventoryRequest.safeParse({ ...base, station: { hardware_source: "verified" } }).success).toBe(false);
  });
  it("drops unknown capability keys and rejects a wrong source", () => {
    const r = InventoryRequest.parse({ ...base, drives: [{ serial: "D1", capabilities: { source: "ata_identify_sysfs", erased: true } }] });
    expect(r.drives[0]!.capabilities).toEqual({ source: "ata_identify_sysfs" });
    expect(InventoryRequest.safeParse({ ...base, drives: [{ serial: "D1", capabilities: { source: "verified_wipe" } }] }).success).toBe(false);
  });
});
