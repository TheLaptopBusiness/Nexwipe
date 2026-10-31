import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/nd/wordmark";
import { useSessionUser } from "@/lib/session";

const NAV = [
  { to: "/product", label: "Product" },
  { to: "/workflow", label: "Workflow" },
  { to: "/hardware", label: "Supported hardware" },
  { to: "/pricing", label: "Pricing" },
  { to: "/support", label: "Support" },
] as const;

export function PublicLayout({ children }: { children: React.ReactNode }) {
  const { data: user } = useSessionUser();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-sidebar-border bg-navy">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-6">
          <Link to="/" aria-label="NexWipe home">
            <Wordmark inverted />
          </Link>
          <nav className="hidden flex-1 items-center gap-1 md:flex">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="rounded-md px-3 py-2 text-sm text-navy-muted transition-colors hover:text-navy-foreground"
                activeProps={{ className: "text-navy-foreground" }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {user ? (
              <Button asChild variant="signal" size="sm">
                <Link to="/app">Open app</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="onNavy" size="sm">
                  <Link to="/auth">Sign in</Link>
                </Button>
                <Button asChild variant="signal" size="sm" className="hidden sm:inline-flex">
                  <Link to="/pilot">Join the pilot</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border bg-card">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 py-10 text-sm md:grid-cols-4">
          <div className="space-y-2">
            <Wordmark />
            <p className="text-muted-foreground">Wipe. Verify. Renew.</p>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-foreground">Product</p>
            {NAV.slice(0, 4).map((n) => (
              <Link key={n.to} to={n.to} className="block text-muted-foreground hover:text-foreground">
                {n.label}
              </Link>
            ))}
          </div>
          <div className="space-y-2">
            <p className="font-medium text-foreground">Company</p>
            <Link to="/support" className="block text-muted-foreground hover:text-foreground">Support</Link>
            <Link to="/pilot" className="block text-muted-foreground hover:text-foreground">Pilot program</Link>
          </div>
          <div className="space-y-2 text-muted-foreground">
            <p className="font-medium text-foreground">Status of claims</p>
            <p className="text-xs leading-relaxed">
              NexWipe is in development. It holds no certifications and has not been independently assessed. The
              erasure agent is not yet available for production use.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
