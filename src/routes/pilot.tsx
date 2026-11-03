import { createFileRoute, redirect } from "@tanstack/react-router";

// Old address kept so existing links keep working.
export const Route = createFileRoute("/pilot")({
  staticData: { sitemap: false },
  beforeLoad: () => {
    throw redirect({ to: "/demo", replace: true });
  },
});
