import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { needsDbUpdate } from "@/lib/connected-device";

// All reads pass the current org as a filter for UX only. Row-level security is
// what actually restricts results to organizations the user belongs to.

export function useSites() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ["sites", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("sites").select("*").eq("org_id", orgId).order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useClients() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ["clients", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("org_id", orgId).order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useProjects() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ["projects", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, clients(name), sites(name)")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useProjectCounts() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ["project-counts", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("project_device_counts").select("*").eq("org_id", orgId);
      if (error) throw error;
      return new Map(data.map((r) => [r.project_id!, r]));
    },
  });
}

export function useBatchCounts() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ["batch-counts", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("batch_device_counts").select("*").eq("org_id", orgId);
      if (error) throw error;
      return new Map(data.map((r) => [r.batch_id!, r]));
    },
  });
}

export function useBatches(projectId?: string) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ["batches", orgId, projectId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("batches").select("*").eq("org_id", orgId).order("created_at", { ascending: false });
      if (projectId) q = q.eq("project_id", projectId);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
}

export function useMembers() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ["members", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("memberships")
        .select("id, user_id, role, status, created_at, revoked_at, profiles(full_name, email)")
        .eq("org_id", orgId)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });
}

export function memberName(m: { profiles: { full_name: string | null; email: string } | null } | undefined) {
  if (!m?.profiles) return "Unknown user";
  return m.profiles.full_name || m.profiles.email;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

// ----- Phase 2: policies, agents, jobs -----

export function usePolicies() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ["policies", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("policies")
        .select("*, policy_versions(*)")
        .eq("org_id", orgId)
        .order("name");
      if (error) throw error;
      return data.map((p) => {
        const versions = [...p.policy_versions].sort((a, b) => b.version - a.version);
        return { ...p, policy_versions: versions, latest: versions[0] ?? null };
      });
    },
  });
}

export const AGENT_COLUMNS =
  "id, org_id, site_id, name, status, is_simulated, agent_version, platform, hostname, credential_prefix, enrolled_at, last_heartbeat_at, last_state, revoked_at, revoke_reason, read_only";

export function useAgents(opts: { refetchMs?: number } = {}) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ["agents", orgId],
    refetchInterval: opts.refetchMs ?? false,
    queryFn: async () => {
      const { data, error } = await supabase.from("agents").select(AGENT_COLUMNS).eq("org_id", orgId).order("enrolled_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export const JOB_LIST_COLUMNS =
  "id, job_number, status, is_simulated, device_id, drive_id, association_id, target_asset_tag, target_drive_serial, target_drive_interface, execution_outcome, verification_outcome, current_phase, progress_pct, progress_measured, exception_code, created_at, updated_at, last_event_at, agent_id, policy_version_id, policy_versions(version, policies(name))";

// ----- Chromebook processing -----

export function useChromebooks() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ["chromebooks", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chromebook_records")
        .select("*, devices(asset_tag, manufacturer, model, system_serial, hardware_origin, project_id, batch_id)")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
  });
}

export function useChromebook(recordId: string) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ["chromebook", orgId, recordId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chromebook_records")
        .select("*, devices(id, asset_tag, manufacturer, model, system_serial, hardware_origin, received_at, projects(name), batches(name))")
        .eq("org_id", orgId)
        .eq("id", recordId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useChromebookEvents(recordId: string) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ["chromebook-events", orgId, recordId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chromebook_events")
        .select("*")
        .eq("org_id", orgId)
        .eq("record_id", recordId)
        .order("id", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

// ----- Connected devices (station reports) -----

const CONNECTED_COLUMNS =
  "id, agent_id, device_id, device_code, system_serial, payload, is_simulated, is_read_only_test, reported_at, last_reported_at, report_count, review_flags, hardware_origin, hardware_origin_reason, agents(name, platform, status, last_heartbeat_at, reboot_status, reboot_detail, reboot_status_at), devices(asset_tag, grade, hardware_verified, hardware_origin, source)";

export function useConnectedDevices() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ["connected-devices", orgId],
    retry: (n, err) => !needsDbUpdate(err) && n < 3,
    queryFn: async () => {
      const { data, error } = await supabase.from("agent_discoveries").select(CONNECTED_COLUMNS).eq("org_id", orgId)
        .order("last_reported_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
  });
}

export function useConnectedDevice(discoveryId: string) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ["connected-device", orgId, discoveryId],
    retry: (n, err) => !needsDbUpdate(err) && n < 3,
    queryFn: async () => {
      const { data, error } = await supabase.from("agent_discoveries").select(CONNECTED_COLUMNS).eq("org_id", orgId).eq("id", discoveryId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
