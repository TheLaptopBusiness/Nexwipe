// Recovery from "outdated code" loading failures and safe diagnostics for the error screen.
//
// After the app is updated, an open tab may still try to load code files from the previous
// version. Browsers report this as a failed dynamic import. Reloading fetches the current
// version. Rules:
//  - reload automatically at most once per RETRY_WINDOW_MS per tab (guard stored in
//    sessionStorage, so it survives the reload itself and stops a reload loop);
//  - never reload automatically while a form has unsaved input: ask the user instead;
//  - ordinary application errors never reload automatically.

export const RETRY_WINDOW_MS = 5 * 60_000;
export const RETRY_KEY = "nd.staleCodeReloadAt";
export const DIAGNOSTICS_KEY = "nd.lastErrorDiagnostics";

const STALE_RE =
  /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError|Loading chunk [\w-]+ failed/i;

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function isOutdatedCodeError(error: unknown): boolean {
  return STALE_RE.test(errorMessage(error));
}

type KV = Pick<Storage, "getItem" | "setItem">;

export type RecoveryDecision =
  | { action: "reload" }
  | { action: "ask"; reason: "unsaved_work" }
  | { action: "fallback"; reason: "already_retried" | "not_outdated_code" };

/** Decide what to do with an error. Records the retry *before* reloading so the guard survives it. */
export function decideRecovery(error: unknown, opts: { storage: KV | null; now: number; hasUnsavedWork: boolean }): RecoveryDecision {
  if (!isOutdatedCodeError(error)) return { action: "fallback", reason: "not_outdated_code" };
  const last = Number(opts.storage?.getItem(RETRY_KEY) ?? 0) || 0;
  if (last && opts.now - last < RETRY_WINDOW_MS) return { action: "fallback", reason: "already_retried" };
  if (opts.hasUnsavedWork) return { action: "ask", reason: "unsaved_work" };
  try {
    opts.storage?.setItem(RETRY_KEY, String(opts.now));
  } catch {
    // Storage blocked: without a guard we cannot prove we won't loop, so do not auto-reload.
    return { action: "fallback", reason: "already_retried" };
  }
  if (!opts.storage) return { action: "fallback", reason: "already_retried" };
  return { action: "reload" };
}

/** Manual reload chosen by the user: also recorded, so an immediate repeat failure shows the fallback. */
export function recordManualReload(storage: KV | null, now: number): void {
  try {
    storage?.setItem(RETRY_KEY, String(now));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- unsaved work
// Any input/change inside a <form> marks unsaved work until that form is submitted or reset.
// Tracked at document level so it also works when the error boundary has already replaced the page.
let dirtyForms = new WeakSet<HTMLFormElement>();
let dirtyCount = 0;

export function installUnsavedWorkTracker(doc: Document = document): () => void {
  const onInput = (e: Event) => {
    const form = (e.target as HTMLElement | null)?.closest?.("form");
    if (form && !form.hasAttribute("data-no-unsaved-tracking") && !dirtyForms.has(form)) {
      dirtyForms.add(form);
      dirtyCount++;
      console.warn('ND-DEBUG dirty ' + dirtyCount);
    }
  };
  const onDone = (e: Event) => {
    const form = e.target as HTMLFormElement;
    if (dirtyForms.has(form)) {
      dirtyForms.delete(form);
      dirtyCount = Math.max(0, dirtyCount - 1);
    }
  };
  console.warn('ND-DEBUG tracker installed');
  doc.addEventListener("input", onInput, true);
  doc.addEventListener("change", onInput, true);
  doc.addEventListener("submit", onDone, true);
  doc.addEventListener("reset", onDone, true);
  return () => {
    doc.removeEventListener("input", onInput, true);
    doc.removeEventListener("change", onInput, true);
    doc.removeEventListener("submit", onDone, true);
    doc.removeEventListener("reset", onDone, true);
  };
}

export function hasUnsavedWork(): boolean {
  return dirtyCount > 0;
}

export function resetUnsavedWorkForTests(): void {
  dirtyForms = new WeakSet();
  dirtyCount = 0;
}

// ---------------------------------------------------------------- safe diagnostics
const REDACTIONS: [RegExp, string][] = [
  [/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, "[redacted-jwt]"],
  [/\b(ndagt|ndenr)_[A-Za-z0-9]{8,}/g, "$1_[redacted]"],
  [/\bsb_(publishable|secret)_[A-Za-z0-9_-]{8,}/g, "sb_$1_[redacted]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]"],
  [/((?:access|refresh)_token|apikey|api_key|token|password|secret|code)=([^&\s"']+)/gi, "$1=[redacted]"],
  [/"((?:access|refresh)_token|apikey|password|secret)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]"],
  [/\b[0-9a-f]{40,}\b/gi, "[redacted-hex]"],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, rep] of REDACTIONS) out = out.replace(re, rep);
  return out;
}

export interface Diagnostics {
  id: string;
  at: string;
  kind: "outdated_code" | "application_error";
  name: string;
  message: string;
  stack: string;
  path: string; // pathname only: query strings and #fragments can carry tokens
  userAgent: string;
}

export function buildDiagnostics(error: unknown, loc: { pathname: string }, now = new Date(), ua = ""): Diagnostics {
  const e = error instanceof Error ? error : null;
  return {
    id: Math.random().toString(36).slice(2, 10).toUpperCase(),
    at: now.toISOString(),
    kind: isOutdatedCodeError(error) ? "outdated_code" : "application_error",
    name: e?.name ?? typeof error,
    message: redact(errorMessage(error)).slice(0, 500),
    stack: redact(e?.stack ?? "").split("\n").slice(0, 8).join("\n").slice(0, 2000),
    path: redact(loc.pathname).slice(0, 200),
    userAgent: ua.slice(0, 200),
  };
}

export function saveDiagnostics(d: Diagnostics, storage: KV | null): void {
  try {
    storage?.setItem(DIAGNOSTICS_KEY, JSON.stringify(d));
  } catch {
    /* ignore */
  }
}

export function formatDiagnostics(d: Diagnostics): string {
  return [
    `Reference: ${d.id}`,
    `Time: ${d.at}`,
    `Type: ${d.kind}`,
    `Page: ${d.path}`,
    `Error: ${d.name}: ${d.message}`,
    `Browser: ${d.userAgent}`,
    d.stack ? `Stack:\n${d.stack}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function safeSessionStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}
