import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicLayout } from "@/components/nd/public-layout";

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: "Support — NextDrive" },
      { name: "description", content: "Help with NextDrive accounts, inventory and the pilot program." },
      { property: "og:title", content: "Support — NextDrive" },
      { property: "og:description", content: "Help with NextDrive accounts, inventory and the pilot program." },
    ],
  }),
  component: SupportPage,
});

const FAQ = [
  { q: "Can NextDrive erase a laptop from the browser?", a: "No. A browser cannot securely erase a laptop’s internal drive. Erasure is performed by the NextDrive Agent, which boots on the laptop itself. The agent is in development." },
  { q: "Is NextDrive certified?", a: "No. NextDrive holds no certifications and has not been independently assessed." },
  { q: "Which hardware will be supported first?", a: "x86-64 Dell, HP and Lenovo laptops with directly attached SATA and NVMe drives. See the supported hardware page." },
  { q: "Does importing a CSV verify my hardware?", a: "No. Imported rows are recorded as unverified. Hardware identity is verified only when reported by the agent." },
  { q: "I didn’t receive my verification email.", a: "Check your spam folder, then try signing up again with the same address to resend it." },
];

function SupportPage() {
  return (
    <PublicLayout>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-semibold text-foreground">Support</h1>
        <p className="mt-3 text-muted-foreground">
          Pilot customers get direct support during onboarding. Existing customers can reach us through the{" "}
          <Link to="/pilot" className="text-foreground underline underline-offset-4">contact form</Link>.
        </p>
        <dl className="mt-10 divide-y divide-border rounded-xl border border-border bg-card">
          {FAQ.map((f) => (
            <div key={f.q} className="p-5">
              <dt className="font-medium text-foreground">{f.q}</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </PublicLayout>
  );
}
