import { describe, expect, it } from "vitest";
import { batteryHealthPct, canRebootToUsb, deviceSections, deviceSummary, isOnline, needsDbUpdate } from "./connected-device";

const WIN = {
  system: { manufacturer: "Dell Inc.", model: "Latitude 5490", serial: "ABC123", cpu: "Intel Core i5-8350U", ram_bytes: 16e9, cpu_cores: 4, secure_boot: true, boot_mode: "uefi" },
  os: { name: "Windows 10 Pro", version: "10.0.19045" },
  memory_modules: [{ slot: "DIMM A", size_bytes: 8e9 }, { slot: "DIMM B", size_bytes: 8e9 }],
  batteries: [{ design_capacity_mwh: 68000, full_charge_capacity_mwh: 51000, cycle_count: 312 }],
  drives: [{ serial: "S1", interface: "nvme_ssd", capacity_bytes: 256e9 }, { serial: "USB", removable: true, is_boot_medium: true, capacity_bytes: 32e9 }],
  security: { tpm_present: true, tpm_version: "2.0", bitlocker: [{ volume: "C:", protection: "on" }] },
};

const section = (title: string) => deviceSections(WIN).find((s) => s.title === title)!;
const value = (title: string, label: string) => section(title).rows.find((r) => r.label === label)?.value;

describe("connected device display", () => {
  it("summarises a Windows report and leaves the stick out of storage", () => {
    expect(deviceSummary(WIN)).toEqual({ title: "Dell Inc. Latitude 5490", cpu: "Intel Core i5-8350U", ram: "16.0 GB", storage: "256 GB · 1 drive", battery: 75, os: "Windows 10 Pro 10.0.19045" });
  });
  it("computes battery health from capacities, and prefers a reported value", () => {
    expect(batteryHealthPct({ design_capacity_mwh: 50000, full_charge_capacity_mwh: 40000 })).toBe(80);
    expect(batteryHealthPct({ health_pct: 91.4, design_capacity_mwh: 1, full_charge_capacity_mwh: 1 })).toBe(91);
    expect(batteryHealthPct({ design_capacity_mwh: 0, full_charge_capacity_mwh: 10 })).toBeNull();
  });
  it("fills every section of the detail page", () => {
    expect(value("System", "Serial number")).toBe("ABC123");
    expect(section("Memory").items).toHaveLength(2);
    expect(section("Storage").items![1]!.find((r) => r.label === "Note")?.value).toBe("NexWipe stick · not recorded");
    expect(value("Firmware & security", "TPM")).toBe("Present (2.0)");
    expect(value("Firmware & security", "BitLocker")).toBe("C: on");
    expect(value("Firmware & security", "Secure Boot")).toBe("On");
  });
  it("survives garbage from a station without throwing or showing it", () => {
    const junk = { system: { manufacturer: 5, serial: { x: 1 }, ram_bytes: -1 }, drives: "no", batteries: [null, 3], memory_modules: [{ size_bytes: "8GB" }] };
    expect(() => deviceSections(junk)).not.toThrow();
    expect(deviceSummary(junk).title).toBe("Unknown laptop");
    expect(deviceSummary(null).ram).toBeNull();
    expect(deviceSections(junk).find((s) => s.title === "System")!.rows).toEqual([]);
  });
  it("caps long strings", () => {
    expect(value("System", "Model")).toBe("Latitude 5490");
    const long = deviceSections({ system: { model: "x".repeat(5000) } }).find((s) => s.title === "System")!.rows[0]!.value;
    expect(long.length).toBe(120);
  });
  it("shows what each drive advertises, never for the stick", () => {
    const st = deviceSections({ drives: [
      { serial: "N1", interface: "nvme_ssd", capabilities: { source: "nvme_identify_controller", nvme_format_nvm: { supported: true, crypto_erase: true } } },
      { serial: "U1", removable: true, is_boot_medium: true, capabilities: { source: "unavailable", reason: "usb" } },
    ] }).find((x) => x.title === "Storage")!;
    expect(st.items![0]!.find((r) => r.label === "Drive advertises")?.value).toBe("NVMe Format (user-data erase + crypto erase)");
    expect(st.items![1]!.find((r) => r.label === "Drive advertises")).toBeUndefined();
  });
  it("only offers Reboot into NexWipe for the Windows helper", () => {
    expect(canRebootToUsb("windows 10.0.19045")).toBe(true);
    expect(canRebootToUsb("x86_64 6.12.107")).toBe(false);
    expect(canRebootToUsb(null)).toBe(false);
  });
  it("treats stale or missing heartbeats as offline", () => {
    const now = Date.parse("2026-11-02T10:00:00Z");
    expect(isOnline("2026-11-02T09:59:30Z", now)).toBe(true);
    expect(isOnline("2026-11-02T09:58:00Z", now)).toBe(false);
    expect(isOnline(null, now)).toBe(false);
    expect(isOnline("garbage", now)).toBe(false);
  });
});

describe("needsDbUpdate", () => {
  it("recognises missing column/table errors only", () => {
    expect(needsDbUpdate({ code: "42703", message: "column agents_1.reboot_status does not exist" })).toBe(true);
    expect(needsDbUpdate({ code: "42P01" })).toBe(true);
    expect(needsDbUpdate({ code: "42501" })).toBe(false);
    expect(needsDbUpdate(null)).toBe(false);
  });
});
