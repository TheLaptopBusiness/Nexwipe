#!/usr/bin/env bun
// NextDrive Agent API contract check over real HTTP (read-only milestone + security behaviour).
// It never requests or performs an erasure. It enrolls a temporary REAL (not simulated) test station,
// reports clearly fake "CONTRACT-TEST" hardware, exercises replay/duplicate/revocation behaviour, then revokes it.
//
// Usage:
//   ND_BASE=https://<app>  ND_SUPABASE_URL=...  ND_SUPABASE_KEY=<publishable key>
//   ND_USER_TOKEN=<access token of an owner/admin in a two-step verified session>  ND_ORG_ID=<org uuid>
//   [ND_TRANSCRIPT=docs/agent-api/transcript.md] bun scripts/agent-contract-check.ts

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k}`);
  return v;
};
const BASE = env("ND_BASE").replace(/\/$/, "") + "/api/public/agent/v1";
const SB = env("ND_SUPABASE_URL");
const KEY = env("ND_SUPABASE_KEY");
const USER = env("ND_USER_TOKEN");
const ORG = env("ND_ORG_ID");

type Step = { name: string; method: string; path: string; headers: Record<string, string>; body?: unknown; status: number; response: unknown; expect: string; ok: boolean };
const steps: Step[] = [];
const nonce = () => crypto.randomUUID().replace(/-/g, "");
const redact = (v: unknown): unknown =>
  JSON.parse(JSON.stringify(v ?? null).replace(/ndagt_[0-9a-f]{8,}/g, "ndagt_<redacted>").replace(/ndenr_[0-9a-f]{8,}|"enrollment_token":"[^"]+"/g, (m) => (m.startsWith('"') ? '"enrollment_token":"<redacted>"' : "ndenr_<redacted>")));

async function call(name: string, method: "GET" | "POST", path: string, opts: { cred?: string; body?: unknown; ts?: string; nonce?: string; raw?: string; expect: number | number[] }) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.cred) {
    headers["authorization"] = `Bearer ${opts.cred}`;
    headers["x-nd-timestamp"] = opts.ts ?? new Date().toISOString();
    headers["x-nd-nonce"] = opts.nonce ?? nonce();
  }
  const res = await fetch(BASE + path, { method, headers, body: opts.raw ?? (opts.body === undefined ? null : JSON.stringify(opts.body)) });
  let response: unknown = null;
  try { response = await res.json(); } catch { response = null; }
  const exp = Array.isArray(opts.expect) ? opts.expect : [opts.expect];
  const shownHeaders = { ...headers };
  if (shownHeaders["authorization"]) shownHeaders["authorization"] = "Bearer ndagt_<redacted>";
  steps.push({ name, method, path, headers: shownHeaders, body: redact(opts.raw ? "<malformed>" : opts.body), status: res.status, response: redact(response), expect: exp.join("|"), ok: exp.includes(res.status) });
  return { status: res.status, body: response as Record<string, any> };
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: KEY, authorization: `Bearer ${USER}`, "content-type": "application/json" }, body: JSON.stringify(args) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn} failed (${r.status}): ${t}`);
  return t ? JSON.parse(t) : null;
}

const enrollToken: string = await rpc("create_enrollment_token", { _org: ORG, _label: "CONTRACT-TEST station", _site: null, _ttl_hours: 1 });
const suffix = Date.now().toString(36).toUpperCase();
const SYS = `CONTRACT-TEST-SYS-${suffix}`;

await call("Health (no auth)", "GET", "/health", { expect: 200 });
const enr = await call("Enroll with single-use token", "POST", "/enroll", { body: { enrollment_token: enrollToken, name: "CONTRACT-TEST station", agent_version: "contract-check", platform: "x86_64 test", hostname: "contract-test" }, expect: 201 });
const cred = enr.body?.credential as string;
const agentId = enr.body?.agent_id as string;
await call("Enrollment token reuse is rejected", "POST", "/enroll", { body: { enrollment_token: enrollToken, name: "again" }, expect: 401 });
await call("Heartbeat", "POST", "/heartbeat", { cred, body: { state: "idle", agent_version: "contract-check" }, expect: 200 });
const inventoryBody = {
  system: { manufacturer: "Dell Inc.", model: "CONTRACT-TEST Latitude", serial: SYS, cpu: "Test CPU", ram_bytes: 17179869184, bios_version: "1.0.0", boot_mode: "uefi", secure_boot: true },
  station: { agent_version: "contract-check", boot_medium_serial: `CONTRACT-TEST-USB-${suffix}` },
  drives: [
    { serial: `CONTRACT-TEST-NVME-${suffix}`, model: "Test NVMe 512GB", interface: "nvme_ssd", capacity_bytes: 512110190592, firmware: "T1", transport: "nvme", bus_path: "pci-0000:02:00.0-nvme-1", removable: false, is_boot_medium: false },
    { serial: `CONTRACT-TEST-USB-${suffix}`, model: "Boot USB", interface: "unsupported_other", capacity_bytes: 32010928128, transport: "usb", removable: true, is_boot_medium: true },
  ],
};
await call("Inventory discovery (read-only)", "POST", "/inventory", { cred, body: inventoryBody, expect: 200 });
await call("Authorized jobs (none expected)", "GET", "/jobs", { cred, expect: 200 });
await call("Reconcile after restart", "POST", "/reconcile", { cred, body: { jobs: [] }, expect: 200 });

const fixed = nonce();
await call("Request with nonce N", "POST", "/heartbeat", { cred, nonce: fixed, body: { state: "idle" }, expect: 200 });
await call("Replay of nonce N is rejected", "POST", "/heartbeat", { cred, nonce: fixed, body: { state: "idle" }, expect: 409 });
await call("Stale timestamp is rejected", "POST", "/heartbeat", { cred, ts: new Date(Date.now() - 10 * 60_000).toISOString(), body: {}, expect: 401 });
await call("Missing nonce is rejected", "POST", "/heartbeat", { cred, nonce: "", body: {}, expect: 401 });
await call("Unknown credential is rejected", "POST", "/heartbeat", { cred: "ndagt_" + "0".repeat(64), body: {}, expect: 401 });
await call("Malformed JSON is rejected", "POST", "/inventory", { cred, raw: "{not json", expect: 400 });
await call("Schema violation is rejected", "POST", "/inventory", { cred, body: { system: {}, drives: "x" }, expect: 422 });
await call("Event for a job not bound to this station", "POST", `/jobs/${crypto.randomUUID()}/events`, { cred, body: { seq: 1, idempotency_key: "evt-00000001", type: "log", message: "x" }, expect: 404 });

await rpc("revoke_agent", { _agent: agentId, _reason: "Contract check finished" });
await call("Heartbeat after revocation", "POST", "/heartbeat", { cred, body: {}, expect: 401 });
await call("Inventory after revocation", "POST", "/inventory", { cred, body: inventoryBody, expect: 401 });
await call("Jobs after revocation", "GET", "/jobs", { cred, expect: 401 });

const failed = steps.filter((s) => !s.ok);
const md = [
  `# Agent API contract transcript`,
  ``,
  `Captured ${new Date().toISOString()} against \`${BASE}\` by \`scripts/agent-contract-check.ts\`. Credentials and tokens are redacted. Hardware is fake and labelled CONTRACT-TEST. No erasure was requested.`,
  ``,
  `Result: **${steps.length - failed.length}/${steps.length} steps returned the expected status.**`,
  ``,
  ...steps.flatMap((s, i) => [
    `## ${i + 1}. ${s.name} — ${s.ok ? "as expected" : "UNEXPECTED"} (${s.status}, expected ${s.expect})`,
    "```http",
    `${s.method} ${s.path}`,
    ...Object.entries(s.headers).map(([k, v]) => `${k}: ${v}`),
    ...(s.body === null || s.body === undefined ? [] : ["", JSON.stringify(s.body, null, 2)]),
    "```",
    "```json",
    JSON.stringify(s.response, null, 2),
    "```",
    "",
  ]),
].join("\n");
if (process.env["ND_TRANSCRIPT"]) await Bun.write(process.env["ND_TRANSCRIPT"], md);
for (const s of steps) console.log(`${s.ok ? "PASS" : "FAIL"}  ${s.status}  ${s.name}`);
if (failed.length) process.exit(1);
