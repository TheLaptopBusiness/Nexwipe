// Accounts created by an invitation email have no password until the invitee chooses one.
// The `password_set` flag is a UX marker only (user-editable); it grants nothing.
export interface FirstPasswordUser {
  invited_at?: string | null | undefined;
  user_metadata?: Record<string, unknown> | null | undefined;
}

export function needsFirstPassword(user: FirstPasswordUser | null | undefined): boolean {
  if (!user || !user.invited_at) return false;
  return user.user_metadata?.["password_set"] !== true;
}

/** Pages where the first-password redirect must not fire (they handle it themselves). */
export function skipFirstPasswordRedirect(pathname: string): boolean {
  return pathname === "/welcome" || pathname === "/reset-password" || pathname.startsWith("/invite/");
}
