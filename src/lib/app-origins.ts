/** Production addresses of the app; invitation links from these are allowed. */
export const PRODUCTION_ORIGINS = ["https://nexwipe.co", "https://www.nexwipe.co", "https://nexwipe.lovable.app"];

/** Allowed app origins for the link inside the email (never trust an arbitrary header). */
export function isAllowedAppOrigin(origin: string, extra: string[] = []): boolean {
  try {
    const u = new URL(origin);
    if (PRODUCTION_ORIGINS.includes(u.origin) || extra.includes(u.origin)) return true;
    if (u.hostname === "localhost") return true;
    return u.protocol === "https:" && (u.hostname.endsWith(".lovable.app") || u.hostname.endsWith(".lovableproject.com"));
  } catch {
    return false;
  }
}
