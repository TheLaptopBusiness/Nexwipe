import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LoadingBlock } from "@/components/nd/page";
import { safeRedirect } from "@/lib/session";

export const Route = createFileRoute("/auth_/callback")({
  head: () => ({
    meta: [
      { title: "Signing in — NexWipe" },
      { name: "description", content: "Completing sign-in to NexWipe." },
      { property: "og:title", content: "Signing in — NexWipe" },
      { property: "og:description", content: "Completing sign-in to NexWipe." },
    ],
  }),
  component: Callback,
});

function Callback() {
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 20 && !cancelled; i++) {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          const stored = sessionStorage.getItem("nd.postAuth");
          sessionStorage.removeItem("nd.postAuth");
          navigate({ to: safeRedirect(stored), replace: true });
          return;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!cancelled) navigate({ to: "/auth", replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);
  return (
    <div className="flex min-h-screen items-center justify-center">
      <LoadingBlock label="Completing sign-in…" />
    </div>
  );
}
