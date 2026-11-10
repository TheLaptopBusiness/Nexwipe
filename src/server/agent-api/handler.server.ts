// NexWipe Agent API v1 HTTP handler.
// Every authenticated request carries a per-agent credential, a timestamp and a single-use nonce.
// All business rules (state machine, authorization binding, idempotency, sequencing) are enforced
// by SECURITY DEFINER database functions that only the service role may execute; this layer only
// validates input, authenticates and translates results to HTTP. Agents never receive service keys.
import type { ZodTypeAny, z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  AGENT_API_VERSION,
  AckRequest,
  ActionResultRequest,
  DiagnosticResultRequest,
  EnrollRequest,
  EventRequest,
  EvidenceRequest,
  HeartbeatRequest,
  InventoryRequest,
  MAX_BODY_BYTES,
  ReconcileRequest,
  ResultRequest,
  eventPayload,
  parseTimestampHeader,
  statusForDbCode,
} from "@/lib/agent-api/schemas";

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-nd-api-version": AGENT_API_VERSION,
    },
  });
}

async function readBody<S extends ZodTypeAny>(request: Request, schema: S): Promise<z.infer<S>> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES)
    throw new ApiError(413, "payload_too_large", "Request body is too large");
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(400, "invalid_json", "Body must be valid JSON");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ApiError(422, "validation_failed", "Request body failed validation", {
      issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}

type RpcError = { code?: string; message: string; hint?: string | null };

function fromDb(error: RpcError): ApiError {
  const status = statusForDbCode(error.code);
  if (status === 500) {
    console.error("[agent-api] database error", error.code, error.message);
    return new ApiError(500, "internal_error", "Internal error");
  }
  const extra: Record<string, unknown> = {};
  const expected = error.hint?.match(/expected_seq=(\d+)/);
  if (expected) extra["expected_seq"] = Number(expected[1]);
  const code =
    status === 401
      ? "unauthorized"
      : status === 403
        ? "forbidden"
        : status === 404
          ? "not_found"
          : status === 409
            ? "conflict"
            : "unprocessable";
  return new ApiError(
    status,
    error.message.startsWith("Sequence conflict")
      ? "sequence_conflict"
      : error.message.startsWith("Replayed")
        ? "replayed_request"
        : code,
    error.message,
    extra,
  );
}

// The generated client types cover these functions; a loose wrapper keeps call sites compact.
async function rpc<T = Record<string, unknown>>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await (
    supabaseAdmin.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: T; error: RpcError | null }>
  )(fn, args);
  if (error) throw fromDb(error);
  return data;
}

interface AgentIdentity {
  agent_id: string;
  org_id: string;
  is_simulated: boolean;
  name: string;
  read_only: boolean;
  credential_id: string;
  credential_expires_at: string | null;
}

/** Stations should rotate when fewer than this many days of credential lifetime remain. */
export const ROTATE_WITHIN_DAYS = 14;

function credentialInfo(agent: AgentIdentity) {
  const exp = agent.credential_expires_at ? Date.parse(agent.credential_expires_at) : null;
  return {
    mode: agent.read_only ? "read_only" : agent.is_simulated ? "simulated" : "standard",
    credential_expires_at: agent.credential_expires_at,
    rotate_recommended: exp !== null && exp - Date.now() < ROTATE_WITHIN_DAYS * 86_400_000,
  };
}

async function authenticate(request: Request): Promise<AgentIdentity> {
  const header = request.headers.get("authorization") ?? "";
  const credential = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!credential) throw new ApiError(401, "unauthorized", "Missing agent credential");
  const ts = parseTimestampHeader(request.headers.get("x-nd-timestamp"));
  if (!ts) throw new ApiError(401, "unauthorized", "Missing or invalid X-ND-Timestamp header");
  const nonce = request.headers.get("x-nd-nonce");
  if (!nonce) throw new ApiError(401, "unauthorized", "Missing X-ND-Nonce header");
  return rpc<AgentIdentity>("agent_authenticate", {
    _credential: credential,
    _nonce: nonce,
    _timestamp: ts.toISOString(),
  });
}

function jobIdFrom(segment: string | undefined): string {
  if (!segment || !UUID_RE.test(segment)) throw new ApiError(404, "not_found", "Unknown job");
  return segment;
}

/** Convert an agent_job_event result into a response, honouring recorded rejections. */
function eventResponse(result: Record<string, unknown>): Response {
  if (result["ok"] === false) {
    const status =
      typeof result["http_status"] === "number" ? (result["http_status"] as number) : 409;
    return json(status, {
      error: { code: result["error"], message: result["message"] ?? String(result["error"]) },
      job_status: result["job_status"],
      last_seq: result["last_seq"],
      duplicate: result["duplicate"] ?? false,
    });
  }
  const { http_status: _h, ...rest } = result;
  return json(200, rest);
}

export async function handleAgentRequest(request: Request, splat: string): Promise<Response> {
  const method = request.method.toUpperCase();
  const parts = splat.split("/").filter(Boolean);
  try {
    if (method === "GET" && parts.length === 1 && parts[0] === "health") {
      return json(200, {
        ok: true,
        api_version: AGENT_API_VERSION,
        server_time: new Date().toISOString(),
      });
    }

    if (method === "POST" && parts.length === 1 && parts[0] === "enroll") {
      const body = await readBody(request, EnrollRequest);
      const result = await rpc("agent_enroll", {
        _token: body.enrollment_token,
        _name: body.name,
        _version: body.agent_version ?? null,
        _platform: body.platform ?? null,
        _hostname: body.hostname ?? null,
      });
      return json(201, {
        ...result,
        api_version: AGENT_API_VERSION,
        heartbeat_interval_seconds: 30,
      });
    }

    const agent = await authenticate(request);
    const a = agent.agent_id;

    if (method === "POST" && parts.length === 1 && parts[0] === "heartbeat") {
      const body = await readBody(request, HeartbeatRequest);
      const hb = await rpc("agent_heartbeat", {
        _agent: a,
        _state: body.state,
        _version: body.agent_version ?? null,
      });
      return json(200, { ...hb, ...credentialInfo(agent) });
    }
    if (
      method === "POST" &&
      parts.length === 2 &&
      parts[0] === "credentials" &&
      parts[1] === "rotate"
    ) {
      return json(
        200,
        await rpc("agent_rotate_credential", { _agent: a, _credential_id: agent.credential_id }),
      );
    }
    if (method === "POST" && parts.length === 1 && parts[0] === "inventory") {
      const body = await readBody(request, InventoryRequest);
      return json(200, await rpc("agent_report_inventory", { _agent: a, _payload: body }));
    }
    if (
      method === "POST" &&
      parts.length === 2 &&
      parts[0] === "actions" &&
      parts[1] === "result"
    ) {
      const body = await readBody(request, ActionResultRequest);
      return json(
        200,
        await rpc("agent_report_action", {
          _agent: a,
          _action: body.action,
          _ok: body.ok,
          _detail: body.detail ?? null,
        }),
      );
    }
    if (
      method === "POST" &&
      parts.length === 2 &&
      parts[0] === "diagnostics" &&
      parts[1] === "result"
    ) {
      const body = await readBody(request, DiagnosticResultRequest);
      return json(
        200,
        await rpc("agent_report_diagnostic", {
          _agent: a,
          _test: body.test,
          _outcome: body.outcome,
          _result: body.result,
          _detail: body.detail ?? null,
        }),
      );
    }
    if (method === "GET" && parts.length === 1 && parts[0] === "jobs") {
      return json(200, { jobs: await rpc("agent_list_jobs", { _agent: a }) });
    }
    if (method === "POST" && parts.length === 1 && parts[0] === "reconcile") {
      const body = await readBody(request, ReconcileRequest);
      return json(200, await rpc("agent_reconcile", { _agent: a, _jobs: body.jobs }));
    }

    if (parts[0] === "jobs" && parts.length === 3 && method === "POST") {
      const jobId = jobIdFrom(parts[1]);
      const action = parts[2];
      if (action === "ack") {
        const body = await readBody(request, AckRequest);
        return eventResponse(
          await rpc("agent_job_event", {
            _agent: a,
            _job: jobId,
            _type: "ack",
            _seq: body.seq,
            _idem: body.idempotency_key,
            _payload: eventPayload(body),
            _occurred_at: body.occurred_at ?? null,
          }),
        );
      }
      if (action === "events") {
        const body = await readBody(request, EventRequest);
        return eventResponse(
          await rpc("agent_job_event", {
            _agent: a,
            _job: jobId,
            _type: body.type,
            _seq: body.seq,
            _idem: body.idempotency_key,
            _payload: eventPayload(body),
            _occurred_at: body.occurred_at ?? null,
          }),
        );
      }
      if (action === "result") {
        const body = await readBody(request, ResultRequest);
        if (body.stage === "execution" && body.outcome === "passed")
          throw new ApiError(
            422,
            "validation_failed",
            "Execution outcome must be succeeded or failed",
          );
        if (body.stage === "verification" && body.outcome === "succeeded")
          throw new ApiError(
            422,
            "validation_failed",
            "Verification outcome must be passed or failed",
          );
        return eventResponse(
          await rpc("agent_job_event", {
            _agent: a,
            _job: jobId,
            _type: body.stage === "execution" ? "execution_result" : "verification_result",
            _seq: body.seq,
            _idem: body.idempotency_key,
            _payload: eventPayload(body),
            _occurred_at: body.occurred_at ?? null,
          }),
        );
      }
      if (action === "evidence") {
        const body = await readBody(request, EvidenceRequest);
        const result = await rpc("agent_upload_evidence", {
          _agent: a,
          _job: jobId,
          _idem: body.idempotency_key,
          _kind: body.kind,
          _filename: body.filename,
          _content_type: body.content_type ?? "text/plain",
          _content: body.content,
          _sha256: body.sha256.toLowerCase(),
        });
        return json(result["duplicate"] ? 200 : 201, result);
      }
    }

    throw new ApiError(404, "not_found", `No endpoint ${method} /${parts.join("/")}`);
  } catch (e) {
    if (e instanceof ApiError)
      return json(e.status, { error: { code: e.code, message: e.message, ...e.extra } });
    console.error("[agent-api] unexpected error", e);
    return json(500, { error: { code: "internal_error", message: "Internal error" } });
  }
}
