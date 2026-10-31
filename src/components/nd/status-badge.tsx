import { cva, type VariantProps } from "class-variance-authority";
import {
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Ban,
  ShieldAlert,
  PackageCheck,
  Inbox,
  Loader,
  HelpCircle,
  PauseCircle,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const toneVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        success: "border-success/30 bg-success-soft text-success",
        warning: "border-warning/30 bg-warning-soft text-warning",
        danger: "border-danger/30 bg-danger-soft text-danger",
        info: "border-info/30 bg-info-soft text-info",
        neutral: "border-border bg-neutral-soft text-muted-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type Tone = NonNullable<VariantProps<typeof toneVariants>["tone"]>;

export function ToneBadge({
  tone,
  icon: Icon,
  children,
  className,
}: {
  tone: Tone;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(toneVariants({ tone }), className)}>
      {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
      {children}
    </span>
  );
}

type Meta = { label: string; tone: Tone; icon: LucideIcon };

export const DEVICE_STATUS: Record<string, Meta> = {
  received: { label: "Received", tone: "info", icon: Inbox },
  awaiting_processing: { label: "Awaiting processing", tone: "neutral", icon: CircleDashed },
  in_processing: { label: "In processing", tone: "info", icon: Loader },
  quarantined: { label: "Quarantined", tone: "danger", icon: ShieldAlert },
  processed: { label: "Processed", tone: "success", icon: CheckCircle2 },
  released: { label: "Released", tone: "success", icon: PackageCheck },
  referred_manual: { label: "Manual assessment", tone: "warning", icon: HelpCircle },
};

export const PROJECT_STATUS: Record<string, Meta> = {
  planned: { label: "Planned", tone: "neutral", icon: CircleDashed },
  active: { label: "Active", tone: "info", icon: CircleDot },
  on_hold: { label: "On hold", tone: "warning", icon: PauseCircle },
  completed: { label: "Completed", tone: "success", icon: CheckCircle2 },
  cancelled: { label: "Cancelled", tone: "neutral", icon: XCircle },
};

export const BATCH_STATUS: Record<string, Meta> = {
  open: { label: "Open", tone: "info", icon: CircleDot },
  processing: { label: "Processing", tone: "warning", icon: Loader },
  closed: { label: "Closed", tone: "neutral", icon: CheckCircle2 },
};

export const SUPPORT_LEVEL: Record<string, Meta> = {
  in_scope: { label: "In initial scope", tone: "success", icon: CheckCircle2 },
  manual_assessment: { label: "Manual assessment", tone: "warning", icon: HelpCircle },
  blocked: { label: "Not supported", tone: "danger", icon: Ban },
};

export function StatusBadge({ map, value }: { map: Record<string, Meta>; value: string }) {
  const meta = map[value] ?? { label: value, tone: "neutral" as Tone, icon: HelpCircle };
  return (
    <ToneBadge tone={meta.tone} icon={meta.icon}>
      {meta.label}
    </ToneBadge>
  );
}

export const JOB_STATUS: Record<string, Meta> = {
  draft: { label: "Draft", tone: "neutral", icon: CircleDashed },
  awaiting_authorization: { label: "Awaiting authorization", tone: "warning", icon: PauseCircle },
  queued: { label: "Queued", tone: "info", icon: Inbox },
  running: { label: "Running", tone: "info", icon: Loader },
  verifying: { label: "Verifying", tone: "info", icon: Loader },
  awaiting_validation: { label: "Awaiting validation", tone: "warning", icon: HelpCircle },
  approved: { label: "Approved", tone: "success", icon: CheckCircle2 },
  failed: { label: "Failed", tone: "danger", icon: XCircle },
  interrupted: { label: "Interrupted", tone: "danger", icon: PauseCircle },
  unsupported: { label: "Unsupported", tone: "warning", icon: Ban },
  quarantined: { label: "Quarantined", tone: "danger", icon: ShieldAlert },
  cancelled: { label: "Cancelled", tone: "neutral", icon: XCircle },
};

export const OUTCOME: Record<string, Meta> = {
  pending: { label: "Pending", tone: "neutral", icon: CircleDashed },
  succeeded: { label: "Succeeded", tone: "success", icon: CheckCircle2 },
  passed: { label: "Passed", tone: "success", icon: CheckCircle2 },
  failed: { label: "Failed", tone: "danger", icon: XCircle },
  not_run: { label: "Not run", tone: "neutral", icon: Ban },
};

export function SimulatedBadge({ className }: { className?: string }) {
  return (
    <ToneBadge tone="warning" className={cn("font-mono uppercase tracking-wide", className)}>
      Simulated
    </ToneBadge>
  );
}
