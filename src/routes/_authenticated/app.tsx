import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Activity,
  BadgeCheck,
  Boxes,
  Building,
  ChevronsUpDown,
  CreditCard,
  FlaskConical,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  ScrollText,
  Server,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Sun,
  UserCog,
  Users,
  HardDrive,
  MapPin,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Wordmark } from "@/components/nd/wordmark";
import { ErrorBlock, LoadingBlock } from "@/components/nd/page";
import { OrgProvider, useMyMemberships, useOrg } from "@/lib/org-context";
import { useSignOut } from "@/lib/session";
import { can, isPrivileged, ROLE_LABELS, type Capability } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app")({
  head: () => ({
    meta: [
      { title: "NextDrive Cloud" },
      { name: "description", content: "NextDrive operations workspace." },
      { property: "og:title", content: "NextDrive Cloud" },
      { property: "og:description", content: "NextDrive operations workspace." },
    ],
  }),
  component: AppLayout,
});

function AppLayout() {
  const { data, isLoading, error } = useMyMemberships();
  const navigate = useNavigate();

  useEffect(() => {
    if (data && data.length === 0) navigate({ to: "/onboarding", replace: true });
  }, [data, navigate]);

  if (isLoading || (data && data.length === 0))
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingBlock label="Loading your workspace…" />
      </div>
    );
  if (error || !data)
    return (
      <div className="mx-auto max-w-lg p-10">
        <ErrorBlock error={error} />
      </div>
    );

  return (
    <OrgProvider memberships={data}>
      <Shell />
    </OrgProvider>
  );
}

type NavItem = { to: string; label: string; icon: LucideIcon; cap?: Capability; planned?: string };

const NAV: { heading: string; items: NavItem[] }[] = [
  {
    heading: "Operations",
    items: [
      { to: "/app", label: "Dashboard", icon: LayoutDashboard },
      { to: "/app/inventory", label: "Inventory", icon: Boxes, cap: "inventory.view" },
      { to: "/app/projects", label: "Projects & batches", icon: FolderKanban },
      { to: "/app/clients", label: "Clients", icon: Building, cap: "inventory.view" },
    ],
  },
  {
    heading: "Erasure",
    items: [
      { to: "/app/jobs", label: "Jobs", icon: Activity, cap: "jobs.view" },
      { to: "/app/policies", label: "Policies", icon: SlidersHorizontal, cap: "jobs.view" },
      { to: "/app/agents", label: "Agents & stations", icon: Server, cap: "agents.view" },
      { to: "/app/simulator", label: "Agent simulator", icon: FlaskConical, cap: "simulator.run" },
      { to: "#", label: "Reports", icon: FileText, planned: "Phase 3" },
      { to: "#", label: "Billing & credits", icon: CreditCard, planned: "Phase 4" },
    ],
  },
  {
    heading: "Organization",
    items: [
      { to: "/app/sites", label: "Sites", icon: MapPin, cap: "inventory.view" },
      { to: "/app/team", label: "Team", icon: Users, cap: "team.view" },
      { to: "/app/audit", label: "Audit log", icon: ScrollText, cap: "audit.view" },
      { to: "/app/settings", label: "Settings", icon: Settings, cap: "org.settings" },
      { to: "/app/hardware", label: "Supported hardware", icon: HardDrive },
    ],
  },
];

function SidebarNav({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const { role } = useOrg();
  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
      {NAV.map((group) => {
        const items = group.items.filter((i) => !i.cap || can(role, i.cap));
        if (role === "customer_viewer" && group.heading === "Erasure") return null;
        if (items.length === 0) return null;
        return (
          <div key={group.heading}>
            <p className="px-3 pb-2 text-[0.6875rem] font-medium uppercase tracking-wider text-sidebar-foreground/55">
              {group.heading}
            </p>
            <ul className="space-y-0.5">
              {items.map((item) =>
                item.planned ? (
                  <li
                    key={item.label}
                    className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/40"
                    title={`Not built yet — ${item.planned}`}
                  >
                    <item.icon className="size-4" aria-hidden />
                    <span className="flex-1">{item.label}</span>
                    <span className="rounded border border-sidebar-border px-1.5 text-[0.625rem] uppercase tracking-wide">
                      Planned
                    </span>
                  </li>
                ) : (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      onClick={onNavigate}
                      activeOptions={{ exact: item.to === "/app" }}
                      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground font-medium" }}
                    >
                      <item.icon className="size-4" aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                ),
              )}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function OrgSwitcher() {
  const { current, memberships, setCurrentOrgId } = useOrg();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md border border-sidebar-border px-3 py-2 text-left text-sm text-sidebar-accent-foreground hover:bg-sidebar-accent">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{current.org.name}</p>
          <p className="truncate text-xs text-sidebar-foreground/60">{ROLE_LABELS[current.role]}</p>
        </div>
        <ChevronsUpDown className="size-4 opacity-60" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {memberships.map((m) => (
          <DropdownMenuItem key={m.org.id} onClick={() => setCurrentOrgId(m.org.id)}>
            <span className="flex-1 truncate">{m.org.name}</span>
            {m.org.id === current.org.id && <BadgeCheck className="size-4 text-success" aria-hidden />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/onboarding">Create another organization</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-16 items-center border-b border-sidebar-border px-5">
        <Link to="/app" onClick={onNavigate}>
          <Wordmark inverted />
        </Link>
      </div>
      <div className="border-b border-sidebar-border p-3">
        <OrgSwitcher />
      </div>
      <SidebarNav onNavigate={onNavigate} />
      <div className="border-t border-sidebar-border px-5 py-3 text-[0.6875rem] leading-relaxed text-sidebar-foreground/50">
        Phase 2 · No erasure is performed by this application. The agent simulator never touches a disk.
      </div>
    </div>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.classList.toggle("dark", next);
        try {
          localStorage.setItem("nd.theme", next ? "dark" : "light");
        } catch {
          /* ignore */
        }
      }}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}

function UserMenu() {
  const signOut = useSignOut();
  const { data: user } = useQuery({
    queryKey: ["auth-user"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });
  const initials = (user?.user_metadata?.["full_name"] as string | undefined)?.split(" ").map((p) => p[0]).slice(0, 2).join("") || user?.email?.[0]?.toUpperCase() || "?";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 px-2" aria-label="Account menu">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {initials}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{user?.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/app/account">
            <UserCog /> Account & security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={signOut}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MfaNotice() {
  const { role } = useOrg();
  const { data } = useQuery({
    queryKey: ["mfa-factors"],
    queryFn: async () => (await supabase.auth.mfa.listFactors()).data,
    enabled: isPrivileged(role),
  });
  if (!isPrivileged(role) || !data || (data.totp ?? []).some((f) => f.status === "verified")) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-warning/30 bg-warning-soft px-6 py-2.5 text-sm text-warning">
      <ShieldAlert className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">Owners and administrators should protect their account with two-step verification.</span>
      <Link to="/app/account" className="font-medium underline underline-offset-4">
        Set up now
      </Link>
    </div>
  );
}

function Shell() {
  const [open, setOpen] = useState(false);
  const { current } = useOrg();
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 lg:block">
        <Sidebar />
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 border-sidebar-border p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-card/95 px-4 backdrop-blur md:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{current.org.name}</span>
            {current.org.is_demo && (
              <span className="ml-2 rounded bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning">DEMO</span>
            )}
          </div>
          <ThemeToggle />
          <UserMenu />
        </header>
        <MfaNotice />
        <main className={cn("flex-1 px-4 py-6 md:px-8 md:py-8")}>
          <div className="mx-auto max-w-[1600px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
