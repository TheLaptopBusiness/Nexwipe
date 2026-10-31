// SIMULATED agent scenarios. Each one drives the real API contract end to end with clearly
// labelled simulated inventory. Technician steps (job creation, target confirmation) run as the
// signed-in user through the same database functions the app screens use.
import { SimAgentClient, idemKey, sha256Hex, type SimStep, type Transport } from "./agent-client";

export const SCENARIOS = [
  { id: "success", title: "Successful execution and verification", expect: "Job ends Awaiting validation. Nothing is approved automatically." },
  { id: "unsupported_drive", title: "Unsupported drive", expect: "Agent reports no permitted method; job ends Unsupported and the laptop is referred for manual assessment." },
  { id: "execution_failure", title: "Execution failure", expect: "Execution fails; job is quarantined per policy." },
  { id: "verification_failure", title: "Verification failure", expect: "Execution succeeds but verification fails; job is quarantined." },
  { id: "network_interruption", title: "Network interruption and reconnection", expect: "Lost events are replayed after reconciliation, the job passes through Interrupted, and ends Awaiting validation." },
  { id: "duplicate_events", title: "Duplicate events", expect: "Duplicates are idempotent, conflicting sequence numbers, replayed requests and authorization reuse are rejected." },
  { id: "revoked_credentials", title: "Revoked credentials", expect: "After revocation every agent request returns 401 and the active job becomes Interrupted." },
  { id: "identity_mismatch", title: "Drive identity mismatch", expect: "Agent sees a different drive serial; execution is blocked and the job is quarantined." },
  { id: "multi_drive_mixed", title: "Multi-drive laptop with mixed results", expect: "One drive awaits validation, the other fails verification; the laptop cannot be marked processed." },
] as const;

export type ScenarioId = (typeof SCENARIOS)[number]["id"];

export interface PrepareResult {
  device_id: string;
  asset_tag: string;
  system_serial: string;
  drives: { drive_id: string; serial: string; interface: string }[];
  policy_id: string;
  enrollment_token: string;
}

export interface TechnicianOps {
  prepare(scenario: ScenarioId): Promise<PrepareResult>;
  createJob(deviceId: string, driveId: string, policyId: string): Promise<string>;
  submitJob(jobId: string): Promise<void>;
  authorize(jobId: string, agentId: string, assetTag: string, driveSerial: string): Promise<string>;
  revokeAgent(agentId: string, reason: string): Promise<void>;
  jobStatuses(jobIds: string[]): Promise<Record<string, string>>;
  deviceStatus(deviceId: string): Promise<string>;
}

export interface ScenarioResult {
  scenario: ScenarioId;
  title: string;
  expectation: string;
  passed: boolean;
  checks: { label: string; ok: boolean }[];
  device: { id: string; asset_tag: string; status: string };
  agent_id: string | null;
  jobs: { id: string; drive_serial: string; status: string }[];
  steps: SimStep[];
}

interface Ctx {
  agent: SimAgentClient;
  ops: TechnicianOps;
  prep: PrepareResult;
  jobs: { id: string; serial: string; iface: string; authId: string }[];
  checks: { label: string; ok: boolean }[];
}

const SIM = "SIMULATED";

function check(ctx: Ctx, label: string, ok: boolean) {
  ctx.checks.push({ label, ok });
}

async function setup(agent: SimAgentClient, ops: TechnicianOps, scenario: ScenarioId): Promise<Ctx> {
  const prep = await ops.prepare(scenario);
  agent.note("Technician", `Simulator created SIMULATED laptop ${prep.asset_tag} with ${prep.drives.length} simulated drive(s) and a one-time simulated enrollment token.`);
  const enr = await agent.enroll(prep.enrollment_token, "Simulator station");
  if (enr.status !== 201 || !agent.agentId) throw new Error(`Enrollment failed (${enr.status})`);
  await agent.call("Heartbeat", "POST", "/heartbeat", { state: "idle" });
  await agent.call("Report discovered inventory", "POST", "/inventory", {
    system: { manufacturer: "Dell", model: "SIMULATED Latitude 5420", serial: prep.system_serial },
    drives: prep.drives.map((d) => ({
      serial: d.serial,
      model: d.interface === "nvme_ssd" ? "SIMULATED NVMe SSD 512GB" : "SIMULATED SATA SSD 256GB",
      interface: d.interface,
      firmware: "SIM-FW1",
      capabilities: { simulated: true },
    })),
  });
  const ctx: Ctx = { agent, ops, prep, jobs: [], checks: [] };
  for (const d of prep.drives) {
    const jobId = await ops.createJob(prep.device_id, d.drive_id, prep.policy_id);
    await ops.submitJob(jobId);
    const authId = await ops.authorize(jobId, agent.agentId, prep.asset_tag, d.serial);
    agent.note("Technician", `Job created under the simulator policy and authorized: technician confirmed asset tag ${prep.asset_tag} and drive serial ${d.serial}.`);
    ctx.jobs.push({ id: jobId, serial: d.serial, iface: d.interface, authId });
  }
  const list = await agent.call("Retrieve authorized jobs", "GET", "/jobs");
  check(ctx, "Agent receives its authorized jobs", Array.isArray(list.body["jobs"]) && (list.body["jobs"] as unknown[]).length === ctx.jobs.length);
  return ctx;
}

function methodFor(iface: string) {
  return iface === "nvme_ssd" ? "nvme_sanitize_crypto" : "ata_sanitize_crypto";
}

async function ack(ctx: Ctx, job: Ctx["jobs"][number], observedSerial = job.serial) {
  return ctx.agent.call("Acknowledge with local confirmation", "POST", `/jobs/${job.id}/ack`, {
    seq: ctx.agent.nextSeq(job.id),
    idempotency_key: idemKey("ack"),
    authorization_id: job.authId,
    observed: { system_serial: ctx.prep.system_serial, drive_serial: observedSerial },
    local_confirmation: { confirmed: true, typed_serial_suffix: job.serial.slice(-4), operator: `${SIM} operator`, confirmed_at: new Date().toISOString() },
  });
}

async function progress(ctx: Ctx, job: Ctx["jobs"][number], phase: string, pct?: number) {
  return ctx.agent.call(`Progress: ${phase}`, "POST", `/jobs/${job.id}/events`, {
    seq: ctx.agent.nextSeq(job.id),
    idempotency_key: idemKey("prg"),
    type: "progress",
    phase,
    ...(pct === undefined ? { measured: false } : { measured: true, progress_pct: pct }),
    message: `${SIM}: ${phase}`,
  });
}

async function execResult(ctx: Ctx, job: Ctx["jobs"][number], ok: boolean) {
  return ctx.agent.call(ok ? "Execution result: succeeded" : "Execution result: failed", "POST", `/jobs/${job.id}/result`, {
    seq: ctx.agent.nextSeq(job.id),
    idempotency_key: idemKey("exe"),
    stage: "execution",
    outcome: ok ? "succeeded" : "failed",
    method: methodFor(job.iface),
    detail: ok ? { simulated: true, note: `${SIM}: no command was sent to any disk` } : { simulated: true, error: `${SIM}: controller aborted the sanitize command (status 0x0B)` },
  });
}

async function evidence(ctx: Ctx, job: Ctx["jobs"][number]) {
  const content = [
    "*** SIMULATED EVIDENCE — NOT A REAL ERASURE RECORD ***",
    `job=${job.id}`,
    `drive_serial=${job.serial}`,
    `method=${methodFor(job.iface)} (simulated, no disk was touched)`,
    "verification=full_read (simulated)",
    `generated_at=${new Date().toISOString()}`,
  ].join("\n");
  return ctx.agent.call("Upload evidence", "POST", `/jobs/${job.id}/evidence`, {
    idempotency_key: idemKey("evi"),
    kind: "verification_log",
    filename: `SIMULATED-${job.serial}-verification.log`,
    content_type: "text/plain",
    content,
    sha256: await sha256Hex(content),
  });
}

async function verifyResult(ctx: Ctx, job: Ctx["jobs"][number], ok: boolean) {
  return ctx.agent.call(ok ? "Verification result: passed" : "Verification result: failed", "POST", `/jobs/${job.id}/result`, {
    seq: ctx.agent.nextSeq(job.id),
    idempotency_key: idemKey("ver"),
    stage: "verification",
    outcome: ok ? "passed" : "failed",
    method: "full_read",
    detail: ok ? { simulated: true } : { simulated: true, error: `${SIM}: 12 sectors returned non-zero data after sanitize` },
  });
}

async function happyPath(ctx: Ctx, job: Ctx["jobs"][number]) {
  await ack(ctx, job);
  await progress(ctx, job, "Sanitize in progress", 40);
  await progress(ctx, job, "Sanitize in progress", 100);
  await execResult(ctx, job, true);
  await progress(ctx, job, "Full read verification");
  await evidence(ctx, job);
  return verifyResult(ctx, job, true);
}

export async function runScenario(scenario: ScenarioId, ops: TechnicianOps, transport: Transport): Promise<ScenarioResult> {
  const meta = SCENARIOS.find((s) => s.id === scenario);
  if (!meta) throw new Error("Unknown scenario");
  const agent = new SimAgentClient(transport);
  const ctx = await setup(agent, ops, scenario);
  const [j1, j2] = ctx.jobs;
  const expectStatus: Record<string, string> = {};

  switch (scenario) {
    case "success": {
      await happyPath(ctx, j1!);
      expectStatus[j1!.id] = "awaiting_validation";
      break;
    }
    case "unsupported_drive": {
      const r = await agent.call("Report unsupported (before acknowledging)", "POST", `/jobs/${j1!.id}/events`, {
        seq: agent.nextSeq(j1!.id),
        idempotency_key: idemKey("uns"),
        type: "unsupported",
        reason: `${SIM}: drive reports security state "frozen" and no sanitize support; no method permitted by the policy is available.`,
        capabilities: { simulated: true, sanitize: false, security_frozen: true },
      });
      check(ctx, "Unsupported report accepted", r.status === 200);
      expectStatus[j1!.id] = "unsupported";
      break;
    }
    case "execution_failure": {
      await ack(ctx, j1!);
      await progress(ctx, j1!, "Sanitize in progress");
      await execResult(ctx, j1!, false);
      const late = await progress(ctx, j1!, "Late progress after failure");
      check(ctx, "Events after a closed job are rejected (409)", late.status === 409);
      expectStatus[j1!.id] = "quarantined";
      break;
    }
    case "verification_failure": {
      await ack(ctx, j1!);
      await execResult(ctx, j1!, true);
      await evidence(ctx, j1!);
      await verifyResult(ctx, j1!, false);
      expectStatus[j1!.id] = "quarantined";
      break;
    }
    case "network_interruption": {
      const j = j1!;
      await ack(ctx, j);
      await progress(ctx, j, "Sanitize in progress", 20);
      // Two progress events are produced locally but "lost" on the network.
      const lost = [
        { seq: agent.nextSeq(j.id), idempotency_key: idemKey("prg"), type: "progress", phase: "Sanitize in progress", measured: true, progress_pct: 55, message: `${SIM}: buffered while offline` },
        { seq: agent.nextSeq(j.id), idempotency_key: idemKey("prg"), type: "progress", phase: "Sanitize in progress", measured: true, progress_pct: 80, message: `${SIM}: buffered while offline` },
      ];
      agent.note("Network", `${SIM}: connection dropped. Events seq ${lost[0]!.seq} and ${lost[1]!.seq} were buffered on the station and never reached the server.`);
      const intr = await agent.call("Report interruption after reconnecting", "POST", `/jobs/${j.id}/events`, {
        seq: lost[0]!.seq, idempotency_key: idemKey("int"), type: "interrupted", reason: `${SIM}: station lost network for 95 s; local state must be reconciled`,
      }, { note: "The station reconnects and first tries to report the outage with its next local sequence number." });
      check(ctx, "Out-of-order event rejected with expected_seq", intr.status === 409 && (intr.body["error"] as Record<string, unknown>)?.["expected_seq"] === 3);
      const rec = await agent.call("Reconcile", "POST", "/reconcile", { jobs: [{ job_id: j.id, agent_last_seq: lost[1]!.seq }] });
      const info = ((rec.body["jobs"] as Record<string, unknown>[]) ?? []).find((x) => x["job_id"] === j.id);
      check(ctx, "Server reports its last accepted sequence", info?.["server_last_seq"] === 2 && info?.["instruction"] === "replay_from_server_seq");
      for (const ev of lost) await agent.call(`Replay buffered seq ${ev.seq}`, "POST", `/jobs/${j.id}/events`, ev);
      const dup = await agent.call(`Replay buffered seq ${lost[1]!.seq} again`, "POST", `/jobs/${j.id}/events`, lost[1], { note: "Duplicate delivery after reconnect is idempotent." });
      check(ctx, "Duplicate replay is idempotent", dup.status === 200 && dup.body["duplicate"] === true);
      await agent.call("Report interruption", "POST", `/jobs/${j.id}/events`, {
        seq: agent.nextSeq(j.id), idempotency_key: idemKey("int"), type: "interrupted", reason: `${SIM}: station was offline for 95 s; outcome unknown until the drive is re-checked`,
      });
      await agent.call("Resume after re-checking the drive", "POST", `/jobs/${j.id}/events`, {
        seq: agent.nextSeq(j.id), idempotency_key: idemKey("res"), type: "resume", reason: `${SIM}: drive reports sanitize still in progress`,
      });
      await progress(ctx, j, "Sanitize in progress", 100);
      await execResult(ctx, j, true);
      await evidence(ctx, j);
      await verifyResult(ctx, j, true);
      expectStatus[j.id] = "awaiting_validation";
      break;
    }
    case "duplicate_events": {
      const j = j1!;
      await ack(ctx, j);
      const body = { seq: agent.nextSeq(j.id), idempotency_key: idemKey("prg"), type: "progress", phase: "Sanitize in progress", measured: true, progress_pct: 50 };
      await agent.call("Progress", "POST", `/jobs/${j.id}/events`, body);
      const dup = await agent.call("Same event again (same idempotency key)", "POST", `/jobs/${j.id}/events`, body);
      check(ctx, "Duplicate event returns duplicate=true", dup.status === 200 && dup.body["duplicate"] === true);
      const conflict = await agent.call("Different event reusing seq", "POST", `/jobs/${j.id}/events`, { ...body, idempotency_key: idemKey("prg"), progress_pct: 60 });
      check(ctx, "Reused sequence number rejected (409)", conflict.status === 409);
      const keyClash = await agent.call("Same idempotency key, different body", "POST", `/jobs/${j.id}/events`, { ...body, progress_pct: 70 });
      check(ctx, "Idempotency key reuse with a different body rejected (409)", keyClash.status === 409);
      await agent.call("Heartbeat", "POST", "/heartbeat", { state: "busy" });
      const replay = await agent.replayLast("Byte-for-byte replay of the previous request", "Same nonce and timestamp as the request above.");
      check(ctx, "Replayed request (same nonce) rejected", replay.status === 409);
      const reack = await agent.call("Try to reuse the consumed authorization", "POST", `/jobs/${j.id}/ack`, {
        seq: agent.nextSeq(j.id), idempotency_key: idemKey("ack"), authorization_id: j.authId,
        observed: { system_serial: ctx.prep.system_serial, drive_serial: j.serial },
        local_confirmation: { confirmed: true, typed_serial_suffix: j.serial.slice(-4) },
      });
      check(ctx, "Authorization reuse rejected (409)", reack.status === 409);
      agent.setSeq(j.id, agent.peekSeq(j.id) - 1);
      await execResult(ctx, j, true);
      const ev = await evidence(ctx, j);
      const evAgain = await agent.call("Upload the same evidence again", "POST", `/jobs/${j.id}/evidence`, (agent.steps.at(-1)?.request ?? {}) as Record<string, unknown>);
      void ev;
      check(ctx, "Duplicate evidence upload rejected or idempotent", evAgain.status === 200 || evAgain.status === 409);
      await verifyResult(ctx, j, true);
      expectStatus[j.id] = "awaiting_validation";
      break;
    }
    case "revoked_credentials": {
      const j = j1!;
      await ack(ctx, j);
      await progress(ctx, j, "Sanitize in progress", 30);
      await ops.revokeAgent(agent.agentId!, `${SIM}: credential revoked by the simulator`);
      agent.note("Administrator", "The simulated station's credential was revoked.");
      const hb = await agent.call("Heartbeat after revocation", "POST", "/heartbeat", { state: "busy" });
      check(ctx, "Heartbeat rejected with 401", hb.status === 401);
      const p = await progress(ctx, j, "Sanitize in progress", 60);
      check(ctx, "Progress rejected with 401", p.status === 401);
      expectStatus[j.id] = "interrupted";
      break;
    }
    case "identity_mismatch": {
      const j = j1!;
      const r = await ack(ctx, j, `SIMDRV-SWAPPED-${j.serial.slice(-3)}`);
      check(ctx, "Acknowledgement rejected (409 drive_identity_mismatch)", r.status === 409 && (r.body["error"] as Record<string, unknown>)?.["code"] === "drive_identity_mismatch");
      const p = await progress(ctx, j, "Attempt to continue");
      check(ctx, "Further events rejected", p.status === 409);
      expectStatus[j.id] = "quarantined";
      break;
    }
    case "multi_drive_mixed": {
      await happyPath(ctx, j1!);
      await ack(ctx, j2!);
      await execResult(ctx, j2!, true);
      await evidence(ctx, j2!);
      await verifyResult(ctx, j2!, false);
      expectStatus[j1!.id] = "awaiting_validation";
      expectStatus[j2!.id] = "quarantined";
      break;
    }
  }

  const statuses = await ops.jobStatuses(ctx.jobs.map((j) => j.id));
  for (const [id, want] of Object.entries(expectStatus)) {
    const job = ctx.jobs.find((x) => x.id === id)!;
    check(ctx, `Drive ${job.serial} ends ${want.replace(/_/g, " ")}`, statuses[id] === want);
  }
  const deviceStatus = await ops.deviceStatus(ctx.prep.device_id);
  check(ctx, "Laptop is not marked processed (no reviewer approval yet)", deviceStatus !== "processed");
  check(ctx, "No job was approved automatically", Object.values(statuses).every((s) => s !== "approved"));

  return {
    scenario,
    title: meta.title,
    expectation: meta.expect,
    passed: ctx.checks.every((c) => c.ok),
    checks: ctx.checks,
    device: { id: ctx.prep.device_id, asset_tag: ctx.prep.asset_tag, status: deviceStatus },
    agent_id: agent.agentId,
    jobs: ctx.jobs.map((j) => ({ id: j.id, drive_serial: j.serial, status: statuses[j.id] ?? "unknown" })),
    steps: agent.steps,
  };
}
