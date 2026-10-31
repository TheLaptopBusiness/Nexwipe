import { cn } from "@/lib/utils";

/** Original placeholder NexWipe wordmark. Replaceable: swap this component. */
export function Wordmark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 select-none", className)}>
      <svg viewBox="0 0 28 28" className="size-7 shrink-0" aria-hidden>
        <rect x="1" y="1" width="26" height="26" rx="6" className={inverted ? "fill-navy-foreground" : "fill-navy"} />
        <rect x="6" y="8" width="16" height="3" rx="1" className={inverted ? "fill-navy" : "fill-navy-foreground"} opacity="0.35" />
        <rect x="6" y="12.5" width="16" height="3" rx="1" className={inverted ? "fill-navy" : "fill-navy-foreground"} opacity="0.6" />
        <rect x="6" y="17" width="10" height="3" rx="1" className="fill-signal" />
        <circle cx="20" cy="18.5" r="1.6" className="fill-signal" />
      </svg>
      <span
        className={cn(
          "font-display text-lg font-semibold tracking-tight",
          inverted ? "text-navy-foreground" : "text-foreground",
        )}
      >
        Nex<span className="text-signal">Wipe</span>
      </span>
    </span>
  );
}
