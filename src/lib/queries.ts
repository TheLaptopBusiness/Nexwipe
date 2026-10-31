import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";

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
