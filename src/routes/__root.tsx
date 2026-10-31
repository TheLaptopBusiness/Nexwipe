import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { BOOT_RECOVERY_SCRIPT } from "../lib/boot-recovery-script";
import {
  buildDiagnostics,
  decideRecovery,
  formatDiagnostics,
  hasUnsavedWork,
  installUnsavedWorkTracker,
  recordManualReload,
  safeSessionStorage,
  saveDiagnostics,
  type Diagnostics,
  type RecoveryDecision,
} from "../lib/app-recovery";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

const BTN_PRIMARY =
  "inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90";
const BTN_SECONDARY =
  "inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent";

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const [decision, setDecision] = useState<RecoveryDecision | null>(null);
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const d = buildDiagnostics(error, window.location, new Date(), navigator.userAgent);
    const result = decideRecovery(error, { storage: safeSessionStorage(), now: Date.now(), hasUnsavedWork: hasUnsavedWork() });
    setDiag(d);
    setDecision(result);
    if (result.action === "reload") {
      window.location.reload();
      return;
    }
    saveDiagnostics(d, safeSessionStorage());
    // Only redacted details leave the page; the raw error object is never logged or reported.
    const safe = new Error(d.message);
    safe.name = d.name;
    safe.stack = d.stack;
    console.error(`[NextDrive] ${d.kind} ${d.id}: ${d.name}: ${d.message}`);
    reportLovableError(safe, { boundary: "tanstack_root_error_component", diagnostic_id: d.id, kind: d.kind, recovery: result.action });
  }, [error]);

  if (!decision || decision.action === "reload") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4" role="status">
        <p className="text-sm text-muted-foreground">Loading the latest version…</p>
      </div>
    );
  }

  const outdated = decision.reason !== "not_outdated_code";
  const reloadNow = () => {
    recordManualReload(safeSessionStorage(), Date.now());
    window.location.reload();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-lg text-center" role="alert">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {decision.action === "ask" ? "A newer version of NextDrive is available" : "This page didn't load"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {decision.action === "ask"
            ? "This page needs to reload to continue. You have typed information that hasn't been saved — reloading will clear it. Copy anything you need first, then reload."
            : outdated
              ? "The app was updated while this page was open and the new version could not be loaded automatically. Check your connection, then reload the page."
              : "Something went wrong while showing this page. Try again; if it keeps happening, copy the details below and send them to your administrator."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {outdated ? (
            <button onClick={reloadNow} className={BTN_PRIMARY}>
              Reload page
            </button>
          ) : (
            <button
              onClick={() => {
                router.invalidate();
                reset();
              }}
              className={BTN_PRIMARY}
            >
              Try again
            </button>
          )}
          <a href="/" className={BTN_SECONDARY}>
            Go home
          </a>
        </div>
        {diag && (
          <details className="mt-6 rounded-md border border-border bg-card p-3 text-left">
            <summary className="cursor-pointer text-sm font-medium text-foreground">Details for support · reference {diag.id}</summary>
            <pre data-testid="error-diagnostics" className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
              {formatDiagnostics(diag)}
            </pre>
            <button
              className={`${BTN_SECONDARY} mt-2`}
              onClick={() => {
                void navigator.clipboard?.writeText(formatDiagnostics(diag)).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy details"}
            </button>
          </details>
        )}
      </div>
    </div>
  );
}

// Applies a saved dark-mode preference before paint.
const themeScript = `try{if(localStorage.getItem('nd.theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "NextDrive — Wipe. Verify. Renew." },
      {
        name: "description",
        content: "NextDrive Cloud: inventory, job orchestration and evidence records for laptop data-erasure operations.",
      },
      { property: "og:title", content: "NextDrive — Wipe. Verify. Renew." },
      {
        property: "og:description",
        content: "Inventory, job orchestration and evidence records for laptop data-erasure operations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap",
      },
    ],
    // Boot recovery must run before any app code so a failed start-up load never leaves a blank page.
    scripts: [{ children: BOOT_RECOVERY_SCRIPT }, { children: themeScript }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [router, queryClient]);

  useEffect(() => {
    (window as Window & { __ndAppMounted?: boolean }).__ndAppMounted = true;
    document.getElementById("nd-boot-fallback")?.remove();
    return installUnsavedWorkTracker(document);
  }, []);

  useEffect(() => {
    // Production builds report failed code preloads here; same rules as the error screen.
    const onPreloadError = (e: Event) => {
      const err = (e as Event & { payload?: unknown }).payload ?? new Error("Failed to fetch dynamically imported module");
      const d = decideRecovery(err, { storage: safeSessionStorage(), now: Date.now(), hasUnsavedWork: hasUnsavedWork() });
      if (d.action === "reload") {
        e.preventDefault();
        window.location.reload();
      }
      // Otherwise let the error reach the route error screen, which explains it.
    };
    window.addEventListener("vite:preloadError", onPreloadError);
    return () => window.removeEventListener("vite:preloadError", onPreloadError);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
