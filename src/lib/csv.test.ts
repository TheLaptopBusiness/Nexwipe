import { describe, expect, it } from "vitest";
import { parseCsv, toCsv, validateDeviceCsv } from "./csv";

describe("device CSV import", () => {
  it("never marks imported rows as hardware verified", () => {
    const { rows } = validateDeviceCsv("asset_tag,manufacturer\nUTS-1,Dell\n");
    expect(rows[0]!.hardware_verified).toBe(false);
    expect(rows[0]!.source).toBe("csv_import");
  });

  it("requires the asset_tag column", () => {
    expect(validateDeviceCsv("serial\nX\n").issues[0]!.message).toMatch(/asset_tag/);
  });

  it("flags duplicate asset tags within the file", () => {
    const { issues } = validateDeviceCsv("asset_tag\nA1\na1\n");
    expect(issues).toHaveLength(1);
  });

  it("parses quoted fields with commas and quotes", () => {
    expect(parseCsv('a,b\n"x, ""y""",z\n')[1]).toEqual(['x, "y"', "z"]);
  });

  it("neutralizes spreadsheet formulas on export", () => {
    expect(toCsv(["n"], [["=SUM(A1)"]])).toBe("n\r\n'=SUM(A1)");
  });
});
