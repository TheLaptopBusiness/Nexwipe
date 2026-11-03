import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/**
 * Thin progress bar at the top of the app while a page is loading, data is being fetched (e.g. after
 * switching tabs) or something is being saved. Waits 150 ms before showing so instant actions don't flicker.
 */
export function ActivityBar() {
  const navigating = useRouterState({ select: (s) => s.status === "pending" });
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const active = navigating || fetching > 0 || mutating > 0;
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!active) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), 150);
    return () => clearTimeout(t);
  }, [active]);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden" role="progressbar" aria-hidden={!show} aria-label="Loading">
      {show && <div className="h-full w-1/3 animate-[nd-activity_1.1s_ease-in-out_infinite] bg-primary" />}
    </div>
  );
}
