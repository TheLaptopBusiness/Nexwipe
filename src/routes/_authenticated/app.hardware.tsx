import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/nd/page";
import { HardwareScope } from "@/components/nd/hardware-scope";

export const Route = createFileRoute("/_authenticated/app/hardware")({
  component: () => (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="Supported hardware" description="Review before receiving equipment. Out-of-scope hardware is blocked or referred for manual assessment." />
      <HardwareScope />
    </div>
  ),
});
