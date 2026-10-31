// The URL fragment the page was first opened with, captured before the auth client consumes it.
// Email verification links can land on the site's home page (when the requested return address is not
// on the auth service's allow-list); this lets the app continue sign-up instead of leaving the user there.
export const LANDING_HASH = typeof window !== "undefined" ? window.location.hash : "";

export type LandingAction = { kind: "continue_signup" } | { kind: "link_error"; message: string } | { kind: "none" };

export function landingAction(hash: string): LandingAction {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  if (p.get("error_code") || p.get("error")) {
    const code = p.get("error_code");
    return {
      kind: "link_error",
      message:
        code === "otp_expired"
          ? "That email link has expired or was already used. Sign in to get a new verification link."
          : p.get("error_description")?.replace(/\+/g, " ") || "That email link couldn’t be used.",
    };
  }
  const type = p.get("type");
  if (p.get("access_token") && (type === "signup" || type === "email" || type === "magiclink")) return { kind: "continue_signup" };
  return { kind: "none" };
}
