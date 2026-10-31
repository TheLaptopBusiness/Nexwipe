import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { OrgRole } from "@/lib/permissions";

export interface OrgMembership {
  membershipId: string;
  role: OrgRole;
  org: { id: string; name: string; slug: string; is_demo: boolean; status: string };
}

export const membershipsQueryKey = ["my-memberships"] as const;

export async function fetchMyMemberships(): Promise<OrgMembership[]> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from("memberships")
    .select("id, role, organizations(id, name, slug, is_demo, status)")
    .eq("user_id", uid)
    .eq("status", "active")
    .order("created_at");
  if (error) throw error;
  return (data ?? [])
    .filter((m) => m.organizations)
    .map((m) => ({
      membershipId: m.id,
      role: m.role as OrgRole,
      org: m.organizations as OrgMembership["org"],
    }));
}

export function useMyMemberships() {
  return useQuery({ queryKey: membershipsQueryKey, queryFn: fetchMyMemberships });
}

interface OrgContextValue {
  current: OrgMembership;
  memberships: OrgMembership[];
  setCurrentOrgId: (id: string) => void;
  orgId: string;
  role: OrgRole;
}

const OrgContext = createContext<OrgContextValue | null>(null);
const STORAGE_KEY = "nd.currentOrg";

export function OrgProvider({
  memberships,
  children,
}: {
  memberships: OrgMembership[];
  children: React.ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    try {
      setSelected(localStorage.getItem(STORAGE_KEY));
    } catch {
      /* ignore */
    }
  }, []);

  const current = useMemo(
    () => (memberships.find((m) => m.org.id === selected) ?? memberships[0])!,
    [memberships, selected],
  );

  const value = useMemo<OrgContextValue>(
    () => ({
      current,
      memberships,
      orgId: current.org.id,
      role: current.role,
      setCurrentOrgId: (id) => {
        setSelected(id);
        try {
          localStorage.setItem(STORAGE_KEY, id);
        } catch {
          /* ignore */
        }
      },
    }),
    [current, memberships],
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used inside OrgProvider");
  return ctx;
}

export function rememberOrg(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}
