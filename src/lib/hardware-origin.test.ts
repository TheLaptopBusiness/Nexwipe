import { describe, expect, it } from "vitest";
import { hardwareOriginLabel } from "./hardware-origin";

describe("hardware origin labels", () => {
  it("synthetic hardware from a real station stays labelled synthetic, never verified", () => {
    const l = hardwareOriginLabel({ hardware_origin: "synthetic", hardware_verified: true, source: "agent_reported" });
    expect(l.label).toBe("Synthetic test hardware");
    expect(l.label).not.toMatch(/verified/i);
  });

  it("a physical claim from a station is 'station-reported', not 'verified'", () => {
    const l = hardwareOriginLabel({ hardware_origin: "station_reported", hardware_verified: true, source: "agent_reported" });
    expect(l.label).toBe("Station-reported identity");
    expect(l.label).not.toMatch(/verified/i);
    expect(l.explanation).toMatch(/not that the hardware physically exists/);
  });

  it("simulated records are labelled simulated regardless of other fields", () => {
    expect(hardwareOriginLabel({ hardware_origin: "station_reported", hardware_verified: true, source: "agent_reported", is_simulated: true }).label).toBe("Simulated");
  });

  it("manual and CSV records say no station reported them", () => {
    expect(hardwareOriginLabel({ hardware_origin: "not_station_reported", hardware_verified: false, source: "csv_import" }).label).toBe("CSV · not station-reported");
    expect(hardwareOriginLabel({ hardware_origin: "not_station_reported", hardware_verified: false, source: "manual" }).label).toBe("Manual · not station-reported");
  });
  it("labels a record added from a station report as needing a re-scan, not manual", () => {
    const l = hardwareOriginLabel({ hardware_origin: "not_station_reported", hardware_verified: false, source: "manual", from_station: true });
    expect(l.label).toBe("Needs re-scan");
    expect(l.tone).toBe("warning");
  });
});
