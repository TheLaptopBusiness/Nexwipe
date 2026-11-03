import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, zipFiles } from "./zip";

describe("zipFiles", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("produces an archive that unzip extracts byte-for-byte", () => {
    const files = [{ name: "Start NexWipe.cmd", text: "@echo off\r\n" }, { name: "nexwipe-setup.json", text: '{"a":1}\r\n' }];
    const dir = mkdtempSync(join(tmpdir(), "ndzip-"));
    writeFileSync(join(dir, "t.zip"), zipFiles(files));
    execFileSync("unzip", ["-q", "-t", join(dir, "t.zip")]); // throws on any CRC/structure error
    execFileSync("unzip", ["-q", join(dir, "t.zip"), "-d", join(dir, "out")]);
    for (const f of files) expect(readFileSync(join(dir, "out", f.name), "utf8")).toBe(f.text);
  });
});
