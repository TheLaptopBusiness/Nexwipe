import { createFileRoute } from "@tanstack/react-router";
import { PublicLayout } from "@/components/nd/public-layout";
import { HardwareScope } from "@/components/nd/hardware-scope";

export const Route = createFileRoute("/hardware")({
  staticData: { sitemap: true },
  head: () => ({
    meta: [
      { title: "Supported hardware — NexWipe" },
      { name: "description", content: "NexWipe's initial hardware scope: x86-64 Dell, HP and Lenovo laptops with direct SATA and NVMe drives." },
      { property: "og:title", content: "Supported hardware — NexWipe" },
      { property: "og:description", content: "Initial scope: x86-64 Dell, HP and Lenovo laptops with direct SATA and NVMe drives." },
    ],
  }),
  component: HardwarePage,
});

function HardwarePage() {
  return (
    <PublicLayout>
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h1 className="text-4xl font-semibold text-foreground">Supported hardware</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          The initial release targets common business laptops with directly attached drives.
        </p>
        <div className="mt-10">
          <HardwareScope />
        </div>
      </section>
    </PublicLayout>
  );
}
