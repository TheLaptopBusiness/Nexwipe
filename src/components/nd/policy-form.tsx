import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INTERFACE_LABELS, METHOD_LABELS, METHODS_BY_INTERFACE } from "@/lib/jobs";
import { ROLE_LABELS, type OrgRole } from "@/lib/permissions";

export interface PolicyRules {
  allowed_manufacturers: string[];
  allowed_interfaces: string[];
  allowed_methods: string[];
  verification_method: "full_read" | "sample_read";
  verification_sample_pct: number | null;
  require_evidence: boolean;
  reviewer_roles: OrgRole[];
  require_separate_reviewer: boolean;
  on_execution_failure: "fail" | "quarantine";
  on_verification_failure: "fail" | "quarantine";
  authorization_ttl_minutes: number;
}

export const DEFAULT_RULES: PolicyRules = {
  allowed_manufacturers: ["Dell", "HP", "Lenovo"],
  allowed_interfaces: ["nvme_ssd", "sata_ssd"],
  allowed_methods: ["nvme_sanitize_crypto", "ata_sanitize_crypto"],
  verification_method: "full_read",
  verification_sample_pct: null,
  require_evidence: true,
  reviewer_roles: ["owner", "admin"],
  require_separate_reviewer: true,
  on_execution_failure: "quarantine",
  on_verification_failure: "quarantine",
  authorization_ttl_minutes: 30,
};

export function rulesFromVersion(v: {
  allowed_manufacturers: string[];
  allowed_interfaces: string[];
  allowed_methods: string[];
  verification_method: string;
  verification_sample_pct: number | null;
  require_evidence: boolean;
  reviewer_roles: string[];
  require_separate_reviewer: boolean;
  on_execution_failure: string;
  on_verification_failure: string;
  authorization_ttl_minutes: number;
}): PolicyRules {
  return {
    allowed_manufacturers: v.allowed_manufacturers,
    allowed_interfaces: v.allowed_interfaces,
    allowed_methods: v.allowed_methods,
    verification_method: v.verification_method as PolicyRules["verification_method"],
    verification_sample_pct: v.verification_sample_pct,
    require_evidence: v.require_evidence,
    reviewer_roles: v.reviewer_roles as OrgRole[],
    require_separate_reviewer: v.require_separate_reviewer,
    on_execution_failure: v.on_execution_failure as PolicyRules["on_execution_failure"],
    on_verification_failure: v.on_verification_failure as PolicyRules["on_verification_failure"],
    authorization_ttl_minutes: v.authorization_ttl_minutes,
  };
}

const MANUFACTURERS = ["Dell", "HP", "Lenovo"];
const INTERFACES = ["nvme_ssd", "sata_ssd", "sata_hdd"];
const REVIEWER_ROLES: OrgRole[] = ["owner", "admin", "technician"];

function toggle<T>(list: T[], value: T, on: boolean): T[] {
  return on ? Array.from(new Set([...list, value])) : list.filter((x) => x !== value);
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-md border border-border p-4">
      <legend className="px-1 text-sm font-semibold text-foreground">{title}</legend>
      {hint && <p className="-mt-1 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </fieldset>
  );
}

function Check({ id, label, checked, onChange, hint }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

export function PolicyRulesEditor({ value, onChange }: { value: PolicyRules; onChange: (v: PolicyRules) => void }) {
  const set = <K extends keyof PolicyRules>(k: K, v: PolicyRules[K]) => onChange({ ...value, [k]: v });
  const setInterfaces = (ifaces: string[]) => {
    const methods = value.allowed_methods.filter((m) => ifaces.some((i) => (METHODS_BY_INTERFACE[i] ?? []).includes(m)));
    onChange({ ...value, allowed_interfaces: ifaces, allowed_methods: methods });
  };
  return (
    <div className="space-y-4">
      <Section title="Supported hardware" hint="Jobs for laptops or drives outside this scope are created as Unsupported and never reach an agent.">
        <div className="flex flex-wrap gap-5">
          {MANUFACTURERS.map((m) => (
            <Check key={m} id={`mfr-${m}`} label={m} checked={value.allowed_manufacturers.includes(m)} onChange={(on) => set("allowed_manufacturers", toggle(value.allowed_manufacturers, m, on))} />
          ))}
        </div>
        <div className="flex flex-wrap gap-5">
          {INTERFACES.map((i) => (
            <Check key={i} id={`if-${i}`} label={INTERFACE_LABELS[i] ?? i} checked={value.allowed_interfaces.includes(i)} onChange={(on) => setInterfaces(toggle(value.allowed_interfaces, i, on))} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">RAID, USB bridges, eMMC, Macs and Chromebooks are outside the initial scope and cannot be enabled.</p>
      </Section>

      <Section title="Permitted methods" hint="The agent may only report one of these. Any other method quarantines the job.">
        {value.allowed_interfaces.length === 0 && <p className="text-sm text-muted-foreground">Select a drive interface first.</p>}
        <div className="grid gap-4 sm:grid-cols-3">
          {value.allowed_interfaces.map((i) => (
            <div key={i} className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{INTERFACE_LABELS[i]}</p>
              {(METHODS_BY_INTERFACE[i] ?? []).map((m) => (
                <Check key={`${i}-${m}`} id={`m-${i}-${m}`} label={METHOD_LABELS[m] ?? m} checked={value.allowed_methods.includes(m)} onChange={(on) => set("allowed_methods", toggle(value.allowed_methods, m, on))} />
              ))}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Verification requirements">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Verification</Label>
            <Select value={value.verification_method} onValueChange={(v) => onChange({ ...value, verification_method: v as PolicyRules["verification_method"], verification_sample_pct: v === "sample_read" ? (value.verification_sample_pct ?? 10) : null })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="full_read">Full read-back</SelectItem>
                <SelectItem value="sample_read">Sampled read-back</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {value.verification_method === "sample_read" && (
            <div className="space-y-1.5">
              <Label htmlFor="sample-pct">Minimum sample (%)</Label>
              <Input id="sample-pct" type="number" min={1} max={100} value={value.verification_sample_pct ?? 10} onChange={(e) => set("verification_sample_pct", Number(e.target.value))} />
            </div>
          )}
          <div className="flex items-end gap-2 pb-2">
            <Switch id="req-evidence" checked={value.require_evidence} onCheckedChange={(v) => set("require_evidence", v)} />
            <Label htmlFor="req-evidence">Evidence required before verification can pass</Label>
          </div>
        </div>
      </Section>

      <Section title="Approval requirements" hint="Every job needs a human reviewer decision. Nothing is approved automatically.">
        <div className="flex flex-wrap gap-5">
          {REVIEWER_ROLES.map((r) => (
            <Check key={r} id={`rev-${r}`} label={ROLE_LABELS[r]} checked={value.reviewer_roles.includes(r)} onChange={(on) => set("reviewer_roles", toggle(value.reviewer_roles, r, on))} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Switch id="sep-rev" checked={value.require_separate_reviewer} onCheckedChange={(v) => set("require_separate_reviewer", v)} />
          <Label htmlFor="sep-rev">Reviewer must be a different person from the authorizing technician</Label>
        </div>
      </Section>

      <Section title="Failure handling">
        <div className="grid gap-4 sm:grid-cols-3">
          {(["on_execution_failure", "on_verification_failure"] as const).map((k) => (
            <div key={k} className="space-y-1.5">
              <Label>{k === "on_execution_failure" ? "When execution fails" : "When verification fails"}</Label>
              <Select value={value[k]} onValueChange={(v) => set(k, v as "fail" | "quarantine")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="quarantine">Quarantine the drive and laptop</SelectItem>
                  <SelectItem value="fail">Mark the job failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
          <div className="space-y-1.5">
            <Label htmlFor="ttl">Authorization expires after (minutes)</Label>
            <Input id="ttl" type="number" min={5} max={240} value={value.authorization_ttl_minutes} onChange={(e) => set("authorization_ttl_minutes", Number(e.target.value))} />
          </div>
        </div>
      </Section>
    </div>
  );
}

export function useRulesState(initial: PolicyRules = DEFAULT_RULES) {
  return useState<PolicyRules>(initial);
}

export function PolicyVersionSummary({ v }: { v: PolicyRules & { version?: number } }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Manufacturers</dt><dd className="mt-0.5 text-foreground">{v.allowed_manufacturers.join(", ")}</dd></div>
      <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Interfaces</dt><dd className="mt-0.5 text-foreground">{v.allowed_interfaces.map((i) => INTERFACE_LABELS[i] ?? i).join(", ")}</dd></div>
      <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Verification</dt><dd className="mt-0.5 text-foreground">{v.verification_method === "full_read" ? "Full read-back" : `Sampled read-back ≥ ${v.verification_sample_pct}%`}{v.require_evidence ? " · evidence required" : ""}</dd></div>
      <div className="sm:col-span-2 lg:col-span-3"><dt className="text-xs uppercase tracking-wide text-muted-foreground">Methods</dt><dd className="mt-0.5 text-foreground">{v.allowed_methods.map((m) => METHOD_LABELS[m] ?? m).join(" · ")}</dd></div>
      <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Reviewers</dt><dd className="mt-0.5 text-foreground">{v.reviewer_roles.map((r) => ROLE_LABELS[r]).join(", ")}{v.require_separate_reviewer ? " · separate from authorizer" : ""}</dd></div>
      <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">On failure</dt><dd className="mt-0.5 text-foreground">Execution: {v.on_execution_failure} · Verification: {v.on_verification_failure}</dd></div>
      <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Authorization lifetime</dt><dd className="mt-0.5 text-foreground">{v.authorization_ttl_minutes} min, single use</dd></div>
    </dl>
  );
}
