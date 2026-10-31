import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SCENARIOS, type ScenarioId, type ScenarioResult, type TechnicianOps } from "@/simulator/scenarios";

const Input = z.object({
  orgId: z.string().uuid(),
  scenario: z.enum(SCENARIOS.map((s) => s.id) as [ScenarioId, ...ScenarioId[]]),
});

// Runs one SIMULATED scenario. Technician steps use the caller's own session (database roles and
// row-level security apply). Agent steps go through the real Agent API handler in-process.
export const runSimulatorScenario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<ScenarioResult> => {
    const { runScenario } = await import("@/simulator/scenarios");
    const { handleAgentRequest } = await import("@/server/agent-api/handler.server");
    const sb = context.supabase;
    const fail = (e: { message: string } | null) => {
      if (e) throw new Error(e.message);
    };
    const ops: TechnicianOps = {
      async prepare(scenario) {
        const { data: r, error } = await sb.rpc("simulator_prepare", { _org: data.orgId, _scenario: scenario });
        fail(error);
        return r as unknown as Awaited<ReturnType<TechnicianOps["prepare"]>>;
      },
      async createJob(deviceId, driveId, policyId) {
        const { data: id, error } = await sb.rpc("create_job", { _device: deviceId, _drive: driveId, _policy: policyId });
        fail(error);
        return id as string;
      },
      async submitJob(jobId) {
        const { error } = await sb.rpc("submit_job", { _job: jobId });
        fail(error);
      },
      async authorize(jobId, agentId, assetTag, driveSerial) {
        const { data: id, error } = await sb.rpc("authorize_job", {
          _job: jobId, _agent: agentId, _confirm_asset_tag: assetTag, _confirm_drive_serial: driveSerial,
        });
        fail(error);
        return id as string;
      },
      async revokeAgent(agentId, reason) {
        const { error } = await sb.rpc("revoke_agent", { _agent: agentId, _reason: reason });
        fail(error);
      },
      async jobStatuses(ids) {
        const { data: rows, error } = await sb.from("jobs").select("id, status").in("id", ids);
        fail(error);
        return Object.fromEntries((rows ?? []).map((r) => [r.id, r.status]));
      },
      async deviceStatus(deviceId) {
        const { data: row, error } = await sb.from("devices").select("status").eq("id", deviceId).single();
        fail(error);
        return row?.status ?? "unknown";
      },
    };
    const transport = (req: Request) => {
      const splat = new URL(req.url).pathname.replace(/^\/api\/public\/agent\/v1\/?/, "");
      return handleAgentRequest(req, splat);
    };
    return runScenario(data.scenario, ops, transport);
  });
