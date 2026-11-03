import { brandName, pcRating, tagFields } from "./device-tag";

describe("device tag", () => {
  it("names memory modules like the industry does", () => {
    expect(pcRating("DDR4", 2667)).toBe("PC4-21300");
    expect(pcRating("DDR4", 2400)).toBe("PC4-19200");
    expect(pcRating("DDR3", 1600)).toBe("PC3-12800");
    expect(pcRating("LPDDR4", 3200)).toBeNull();
    expect(pcRating(null, 2667)).toBeNull();
  });

  it("shortens maker names", () => {
    expect(brandName("Dell Inc.")).toBe("Dell");
    expect(brandName("Hewlett-Packard")).toBe("HP");
    expect(brandName("LENOVO")).toBe("Lenovo");
    expect(brandName("ASUSTeK COMPUTER INC.")).toBe("ASUSTeK COMPUTER");
  });

  it("builds the tag in the sample's order and skips what was not reported", () => {
    const t = tagFields({
      system: { manufacturer: "Dell Inc.", model: "Inspiron 3585", serial: "8ZQ90Y2", cpu: "AMD Ryzen 5 2500U with Radeon Vega Mobile Gfx", cpu_cores: 4, cpu_threads: 8, ram_bytes: 8589934592 },
      memory_modules: [{ type: "DDR4", speed_mhz: 2667, part_number: "ZION8GBDDR4PC2666" }],
      gpus: [{ name: "AMD Radeon(TM) Vega 8 Graphics" }],
      batteries: [{ health_pct: 43.4 }],
      network_adapters: [{ kind: "ethernet", name: "Realtek PCIe GbE" }, { kind: "wifi", name: "Qualcomm QCA9377 802.11ac" }],
    }, "NW-063HJZX3", "B");
    expect(t.title).toBe("Inspiron 3585 Dell");
    expect(t.spec).toBe("1 / 4 / 8 / 8 / PC4-21300 / AMD Radeon(TM) Vega 8 Graphics / AMD Ryzen 5 2500U with Radeon Vega Mobile Gfx / ZION8GBDDR4PC2666 / 43% / Qualcomm QCA9377 802.11ac");
    expect(t).toMatchObject({ serial: "8ZQ90Y2", uid: "NW-063HJZX3", grade: "B" });
  });

  it("survives an empty or hostile payload", () => {
    const t = tagFields({ system: { model: 5, serial: ["x"] }, memory_modules: "no" }, "NW-00000000", null);
    expect(t).toEqual({ title: "Unknown laptop", spec: "", serial: null, uid: "NW-00000000", grade: null });
  });
});
