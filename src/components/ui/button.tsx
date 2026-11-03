import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { Loader2 } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        signal: "bg-signal text-signal-foreground shadow-sm hover:bg-signal/90 font-semibold",
        onNavy:
          "border border-navy-foreground/25 bg-transparent text-navy-foreground hover:bg-navy-foreground/10",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Shows a spinner and disables the button (for form submit buttons whose work runs elsewhere). */
  loading?: boolean;
}

// A click handler that returns a promise (an async action) shows the spinner until it settles,
// so every button that saves or requests something gives feedback without per-page code.
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, onClick, disabled, children, ...props }, ref) => {
    const [pending, setPending] = React.useState(false);
    const mounted = React.useRef(true);
    React.useEffect(() => () => { mounted.current = false; }, []);
    const busy = loading || pending;
    const handleClick = onClick && ((e: React.MouseEvent<HTMLButtonElement>) => {
      const r = onClick(e) as unknown;
      if (r && typeof (r as Promise<unknown>).then === "function") {
        setPending(true);
        (r as Promise<unknown>).finally(() => { if (mounted.current) setPending(false); });
      }
    });
    if (asChild) {
      return (
        <Slot className={cn(buttonVariants({ variant, size, className }))} ref={ref} onClick={handleClick} {...props}>
          {children}
        </Slot>
      );
    }
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        onClick={handleClick}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        {...props}
      >
        {busy && <Loader2 className="animate-spin" aria-hidden />}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
