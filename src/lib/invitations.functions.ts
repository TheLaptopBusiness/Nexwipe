import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAllowedAppOrigin } from "@/lib/app-origins";

const Input = z.object({
  orgId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(["owner", "admin", "technician", "auditor", "customer_viewer"]),
});

export type InvitationEmailStatus = "sent_new_account" | "sent_existing_account" | "not_sent";

function appOrigin(): string {
  const req = getRequest();
  const candidate = req?.headers.get("origin") ?? (req ? new URL(req.url).origin : "");
  const extra = (process.env["APP_ALLOWED_ORIGINS"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (isAllowedAppOrigin(candidate, extra)) return new URL(candidate).origin;
  throw new Error("Unrecognized app address; cannot build the invitation link");
}

/**
 * Creates the invitation as the signed-in user (the database checks owner/admin + two-step verification),
 * then emails the one-time link. The token is only ever known here and in the email; the database stores its hash.
 */
export const createAndEmailInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { data: token, error } = await context.supabase.rpc("create_invitation", {
      _org: data.orgId,
      _email: data.email,
      _role: data.role,
    });
    if (error || typeof token !== "string") throw new Error(error?.message ?? "Could not create invitation");

    const link = `${appOrigin()}/invite/${token}`;
    let status: InvitationEmailStatus = "not_sent";
    let detail: string | null = null;
    try {
      // Privileged only for sending the auth email; the caller was authorized by create_invitation above.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const invited = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, { redirectTo: link });
      if (!invited.error) {
        status = "sent_new_account";
      } else if (/already|registered|exists/i.test(invited.error.message)) {
        const otp = await supabaseAdmin.auth.signInWithOtp({
          email: data.email,
          options: { shouldCreateUser: false, emailRedirectTo: link },
        });
        if (otp.error) detail = otp.error.message;
        else status = "sent_existing_account";
      } else {
        detail = invited.error.message;
      }
    } catch (e) {
      detail = e instanceof Error ? e.message : "Email could not be sent";
    }
    if (status === "not_sent") console.error("[invitations] email not sent:", detail);
    return { link, status, detail };
  });
