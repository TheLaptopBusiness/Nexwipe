import { createFileRoute } from "@tanstack/react-router";

// NextDrive Agent API v1. Public prefix so stations can reach it; every handler authenticates
// the agent itself (see src/server/agent-api/handler.server.ts and docs/agent-api/openapi.yaml).
async function handle(request: Request, splat: string | undefined) {
  const { handleAgentRequest } = await import("@/server/agent-api/handler.server");
  return handleAgentRequest(request, splat ?? "");
}

export const Route = createFileRoute("/api/public/agent/v1/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => handle(request, params._splat),
      POST: ({ request, params }) => handle(request, params._splat),
    },
  },
});
