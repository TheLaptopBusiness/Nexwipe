// SIMULATED agent client. Speaks the real NextDrive Agent API v1 contract through a pluggable
// transport (in-process handler inside the app, or fetch against a deployed URL). It never
// touches a disk: every "operation" is a canned message clearly marked SIMULATED.
import { AGENT_API_BASE } from "@/lib/agent-api/schemas";

export type Transport = (request: Request) => Promise<Response>;

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export interface SimStep {
  n: number;
  label: string;
  method: string;
  path: string;
  request: Json;
  status: number;
  response: Json;
  note: string | null;
}

function randomId(bytes = 12): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

interface Sent {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string | undefined;
}

export class SimAgentClient {
  credential: string | null = null;
  agentId: string | null = null;
  steps: SimStep[] = [];
  private seqs = new Map<string, number>();
  private lastSent: Sent | null = null;

  constructor(
    private transport: Transport,
    private origin = "http://simulator.local",
  ) {}

  nextSeq(jobId: string): number {
    const n = (this.seqs.get(jobId) ?? 0) + 1;
    this.seqs.set(jobId, n);
    return n;
  }
  setSeq(jobId: string, value: number) {
    this.seqs.set(jobId, value);
  }
  peekSeq(jobId: string): number {
    return this.seqs.get(jobId) ?? 0;
  }

  note(label: string, note: string) {
    this.steps.push({ n: this.steps.length + 1, label, method: "—", path: "—", request: null, status: 0, response: null, note });
  }

  private async send(label: string, sent: Sent, note?: string | undefined): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await this.transport(
      new Request(this.origin + AGENT_API_BASE + sent.path, { method: sent.method, headers: sent.headers, body: sent.body ?? null }),
    );
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    const logged = sent.body ? (redact(JSON.parse(sent.body)) as Json) : null;
    this.steps.push({ n: this.steps.length + 1, label, method: sent.method, path: AGENT_API_BASE + sent.path, request: logged, status: res.status, response: redact(body) as Json, note: note ?? null });
    this.lastSent = sent;
    return { status: res.status, body };
  }

  async call(label: string, method: "GET" | "POST", path: string, body?: unknown, opts: { auth?: boolean; note?: string | undefined } = {}) {
    const headers: Record<string, string> = { "content-type": "application/json", "x-nd-agent-version": "sim-0.2.0" };
    if (opts.auth !== false) {
      headers["authorization"] = `Bearer ${this.credential ?? ""}`;
      headers["x-nd-timestamp"] = new Date().toISOString();
      headers["x-nd-nonce"] = randomId(16);
    }
    return this.send(label, { method, path, headers, body: body === undefined ? undefined : JSON.stringify(body) }, opts.note);
  }

  /** Re-send the previous HTTP request byte-for-byte (same nonce) to exercise replay protection. */
  async replayLast(label: string, note?: string | undefined) {
    if (!this.lastSent) throw new Error("Nothing to replay");
    return this.send(label, this.lastSent, note);
  }

  async enroll(token: string, name: string) {
    const r = await this.call("Enroll station", "POST", "/enroll", {
      enrollment_token: token,
      name,
      agent_version: "sim-0.2.0",
      platform: "SIMULATOR (no disk access)",
      hostname: "simulator",
    }, { auth: false });
    if (r.status === 201) {
      this.credential = String(r.body["credential"]);
      this.agentId = String(r.body["agent_id"]);
    }
    return r;
  }
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "credential" || k === "enrollment_token") out[k] = typeof v === "string" ? `${v.slice(0, 10)}…(redacted)` : v;
      else if (k === "content" && typeof v === "string" && v.length > 160) out[k] = `${v.slice(0, 160)}…`;
      else out[k] = redact(v);
    }
    return out;
  }
  return value;
}

export function idemKey(prefix: string): string {
  return `${prefix}-${randomId(8)}`;
}
