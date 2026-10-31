import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export function useSessionUser() {
  return useQuery({
    queryKey: ["session-user"],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.user ?? null;
    },
    staleTime: 30_000,
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
}

/** Only allow same-origin relative redirect targets. */
export function safeRedirect(target: unknown, fallback = "/app"): string {
  if (typeof target !== "string") return fallback;
  try {
    const url = new URL(target, "http://x");
    if (url.origin !== "http://x") {
      if (typeof window !== "undefined" && url.origin === window.location.origin) {
        return url.pathname + url.search;
      }
      return fallback;
    }
    if (!target.startsWith("/") || target.startsWith("//")) return fallback;
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}
