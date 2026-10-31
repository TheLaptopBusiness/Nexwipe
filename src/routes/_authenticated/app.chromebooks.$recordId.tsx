import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, ExternalLink, Printer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorBlock, LoadingBlock, Mono, PageHeader, errorMessage } from "@/components/nd/page";
import { ToneBadge } from "@/components/nd/status-badge";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { formatDate, formatDateTime, memberName, useChromebook, useChromebookEvents, useMembers } from "@/lib/queries";
import {
  DIAGNOSTIC_CHECKS,
  EVIDENCE_KIND_LABEL,
  MANAGEMENT_LABEL,
  OFFICIAL_REFERENCES,
  RESET_LABEL,
  RESET_METHOD_LABEL,
  SOURCE_LABEL,
  nextStep,
  resaleBlockers,
  resetAuthorizationBlockers,
  type DiagnosticResult,
  type ManagementStatus,
  type ResetStatus,
  type ValueSource,
} from "@/lib/chromebook";

export const Route = createFileRoute("/_authenticated/app/chromebooks/$recordId")({
  head: () => ({ meta: [{ title: "Chromebook record — NexWipe" }] }),
  component: ChromebookDetail,
});

type Rec = NonNullable<ReturnType<typeof useChromebook>["data"]>;
type Tab = "workflow" | "record" | "history";

function useRun(recordId: string) {
  const { orgId } = useOrg();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function run(p: PromiseLike<{ error: unknown }>, ok: string) {
    setBusy(true);
    const { error } = await p;
    setBusy(false);
    if (error) {
      toast.error(errorMessage(error));
      return false;
    }
    toast.success(ok);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["chromebook", orgId, recordId] }),
      qc.invalidateQueries({ queryKey: ["chromebook-events", orgId, recordId] }),
      qc.invalidateQueries({ queryKey: ["chromebooks", orgId] }),
      qc.invalidateQueries({ queryKey: ["chromebook-resale-check", orgId, recordId] }),
    ]);
    return true;
  }
  return { run, busy };
}

function ChromebookDetail() {
  const { recordId } = Route.useParams();
  const rec = useChromebook(recordId);
  const [tab, setTab] = useState<Tab>("workflow");
  if (rec.isLoading) return <LoadingBlock />;
  if (rec.error) return <ErrorBlock error={rec.error} />;
  if (!rec.data) return <ErrorBlock error={new Error("Chromebook record not found")} />;
  const r = rec.data;
  const d = r.devices;
  const m = MANAGEMENT_LABEL[r.management_status as ManagementStatus];
  const rs = RESET_LABEL[r.reset_status as ResetStatus];
  return (
    <div className="space-y-5">
      <Link to="/app/chromebooks" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden">
        <ArrowLeft className="size-4" /> Chromebooks
      </Link>
      <PageHeader
        title={d?.asset_tag ?? "Chromebook"}
        description={<>{[d?.manufacturer, d?.model].filter(Boolean).join(" ") || "Model unknown"} · Serial <Mono>{d?.system_serial ?? "unknown"}</Mono></>}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            {r.is_synthetic && <ToneBadge tone="warning">Synthetic test record — never physical evidence</ToneBadge>}
            <ToneBadge tone={m?.tone ?? "neutral"}>Management: {m?.label}</ToneBadge>
            <ToneBadge tone={rs?.tone ?? "neutral"}>Reset: {rs?.label}</ToneBadge>
          </div>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="inline-flex rounded-md border border-border bg-card p-0.5" role="tablist">
          {(["workflow", "record", "history"] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`rounded px-3 py-1.5 text-sm ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {t === "workflow" ? "Workflow" : t === "record" ? "Processing record" : "History"}
            </button>
          ))}
        </div>
        <p className="text-sm"><span className="text-muted-foreground">Next step:</span> <span className="font-medium text-foreground">{nextStep(r)}</span></p>
      </div>
      {tab === "workflow" && <Workflow r={r} />}
      {tab === "record" && <ProcessingRecord r={r} />}
      {tab === "history" && <History recordId={r.id} />}
    </div>
  );
}

function Step({ n, title, children, done }: { n: number; title: string; children: React.ReactNode; done?: boolean }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-foreground">
        <span className={`flex size-6 items-center justify-center rounded-full text-xs ${done ? "bg-success text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Note({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warning" }) {
  return (
    <div className={`flex gap-2 rounded-md border p-3 text-xs ${tone === "warning" ? "border-warning/30 bg-warning-soft text-warning" : "border-border bg-muted/40 text-muted-foreground"}`}>
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

function Workflow({ r }: { r: Rec }) {
  const { role } = useOrg();
  const op = can(role, "chromebooks.operate");
  const auth = can(role, "chromebooks.authorize");
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Identity r={r} canEdit={op} />
      <Ownership r={r} canEdit={op} />
      <Management r={r} canEdit={op} />
      <Reset r={r} canOperate={op} canAuthorize={auth} />
      <OnlineSetup r={r} canEdit={op} />
      <Diagnostics r={r} canEdit={op} />
      <Review r={r} canReview={auth} />
    </div>
  );
}

// ---------- 1. identity ----------
const FIELDS = [
  { key: "board", label: "Board / platform", type: "text" },
  { key: "cpu_arch", label: "Processor architecture", type: "select", options: [["unknown", "Unknown"], ["x86_64", "x86-64"], ["arm", "ARM"]] },
  { key: "storage_type", label: "Storage type", type: "select", options: [["unknown", "Unknown"], ["emmc", "eMMC"], ["sata", "SATA"], ["nvme", "NVMe"], ["ufs", "UFS"]] },
  { key: "storage_capacity_gb", label: "Storage capacity (GB)", type: "number" },
  { key: "chromeos_version", label: "ChromeOS version", type: "text" },
] as const;

function Identity({ r, canEdit }: { r: Rec; canEdit: boolean }) {
  const { run, busy } = useRun(r.id);
  const rec = r as unknown as Record<string, unknown>;
  const [vals, setVals] = useState<Record<string, { value: string; source: string }>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, { value: rec[f.key] == null ? (f.type === "select" ? "unknown" : "") : String(rec[f.key]), source: String(rec[`${f.key === "storage_capacity_gb" ? "storage_capacity" : f.key}_source`] ?? "physically_observed") }])),
  );
  const [aue, setAue] = useState({ date: r.aue_date ?? "", source: r.aue_source ?? "", retrieved_on: r.aue_retrieved_on ?? "" });
  async function save() {
    await run(supabase.rpc("chromebook_update_identity", { _record: r.id, _fields: { ...vals, aue } }), "Identification saved");
  }
  return (
    <Step n={1} title="Identify" done={!!r.board || r.cpu_arch !== "unknown"}>
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => {
          const v = vals[f.key]!;
          const set = (patch: Partial<typeof v>) => setVals((s) => ({ ...s, [f.key]: { ...v, ...patch } }));
          const unknown = v.value === "" || v.value === "unknown";
          return (
            <div key={f.key} className="space-y-1">
              <Label>{f.label}</Label>
              {f.type === "select" ? (
                <Select value={v.value} onValueChange={(x) => set({ value: x })} disabled={!canEdit}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{f.options.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                </Select>
              ) : (
                <Input value={v.value} onChange={(e) => set({ value: e.target.value })} type={f.type} placeholder="Unknown" disabled={!canEdit} className={f.key === "board" ? "font-mono uppercase" : ""} />
              )}
              {!unknown && (
                <Select value={v.source} onValueChange={(x) => set({ source: x })} disabled={!canEdit}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="physically_observed">{SOURCE_LABEL.physically_observed}</SelectItem>
                    <SelectItem value="manual">{SOURCE_LABEL.manual}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div><Label>Automatic Update Expiration</Label><Input type="date" value={aue.date} onChange={(e) => setAue({ ...aue, date: e.target.value })} disabled={!canEdit} /></div>
        <div><Label>AUE source</Label><Input value={aue.source} onChange={(e) => setAue({ ...aue, source: e.target.value })} placeholder="e.g. Google AUE policy page" disabled={!canEdit} /></div>
        <div><Label>Retrieved on</Label><Input type="date" value={aue.retrieved_on} onChange={(e) => setAue({ ...aue, retrieved_on: e.target.value })} disabled={!canEdit} /></div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">The board name is shown at chrome://version or on the recovery screen. Values left empty stay unknown. API-reported values can only come from an authorized integration (none connected).</p>
      {canEdit && <Button className="mt-3" size="sm" onClick={save} disabled={busy}>Save identification</Button>}
    </Step>
  );
}

// ---------- 2. ownership ----------
function Ownership({ r, canEdit }: { r: Rec; canEdit: boolean }) {
  const { run, busy } = useRun(r.id);
  const [by, setBy] = useState(r.ownership_authorized_by ?? "");
  const [ref, setRef] = useState(r.ownership_reference ?? "");
  return (
    <Step n={2} title="Ownership / processing authorization" done={r.ownership_status === "recorded"}>
      {r.ownership_status === "recorded" && (
        <p className="mb-3 text-sm">Recorded {formatDateTime(r.ownership_recorded_at)}: <span className="font-medium">{r.ownership_authorized_by}</span> · ref <Mono>{r.ownership_reference}</Mono></p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label>Authorized by (organization / person)</Label><Input value={by} onChange={(e) => setBy(e.target.value)} disabled={!canEdit} /></div>
        <div><Label>Reference (contract, PO, letter)</Label><Input value={ref} onChange={(e) => setRef(e.target.value)} disabled={!canEdit} /></div>
      </div>
      {canEdit && <Button className="mt-3" size="sm" disabled={busy} onClick={() => run(supabase.rpc("chromebook_record_ownership", { _record: r.id, _authorized_by: by, _reference: ref }), "Authorization recorded")}>Record authorization</Button>}
    </Step>
  );
}

// ---------- 3. management ----------
const MGMT_ACTIONS: { status: ManagementStatus; label: string; needsNote: boolean; hint: string }[] = [
  { status: "management_observed", label: "Management observed", needsNote: false, hint: "e.g. “This device is managed by …” on the sign-in screen" },
  { status: "deprovision_requested", label: "Deprovisioning requested", needsNote: true, hint: "Who you asked, how and when" },
  { status: "admin_reported_deprovisioned", label: "Administrator reports deprovisioned", needsNote: true, hint: "Who reported it and how (email, ticket)" },
  { status: "owner_reported_never_managed", label: "Owner reports never managed", needsNote: true, hint: "Who stated it was never enrolled, how and when. Not allowed once management was observed." },
  { status: "blocked", label: "Blocked by enrollment or management", needsNote: true, hint: "What blocks processing" },
];

function Management({ r, canEdit }: { r: Rec; canEdit: boolean }) {
  const { run, busy } = useRun(r.id);
  const [note, setNote] = useState("");
  const done = ["admin_reported_deprovisioned", "deprovision_confirmed_integration", "owner_reported_never_managed", "online_setup_checked"].includes(r.management_status);
  return (
    <Step n={3} title="Management status" done={done}>
      <p className="mb-3 text-sm">Current: <ToneBadge tone={MANAGEMENT_LABEL[r.management_status as ManagementStatus]?.tone ?? "neutral"}>{MANAGEMENT_LABEL[r.management_status as ManagementStatus]?.label}</ToneBadge></p>
      <Note>Never infer deprovisioning from a Powerwash, a recovery, a missing “managed” label or an offline setup screen. Only the owning organization can deprovision its devices; NexWipe cannot remove another organization’s management.</Note>
      {canEdit && (
        <>
          <Textarea className="mt-3" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notes / evidence (required for requests, administrator reports and blocks)" rows={2} />
          <div className="mt-2 flex flex-wrap gap-2">
            {MGMT_ACTIONS.map((a) => (
              <Button key={a.status} size="sm" variant="outline" title={a.hint} disabled={busy || (a.needsNote && !note.trim())}
                onClick={async () => { if (await run(supabase.rpc("chromebook_set_management", { _record: r.id, _status: a.status, _notes: note }), a.label)) setNote(""); }}>
                {a.label}
              </Button>
            ))}
          </div>
        </>
      )}
      <div className="mt-3 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Google Admin integration: Not connected.</span> Confirmation through an authorized integration is not available yet; no simulated results are shown.
      </div>
    </Step>
  );
}

// ---------- 4. reset ----------
function Reset({ r, canOperate, canAuthorize }: { r: Rec; canOperate: boolean; canAuthorize: boolean }) {
  const { run, busy } = useRun(r.id);
  const [serial, setSerial] = useState("");
  const [method, setMethod] = useState("powerwash");
  const [note, setNote] = useState("");
  const blockers = resetAuthorizationBlockers(r);
  const st = r.reset_status as ResetStatus;
  const step = (action: string, extra: { _method?: string; _confirm_serial?: string; _notes?: string }, ok: string) =>
    run(supabase.rpc("chromebook_reset_step", { _record: r.id, _action: action, ...extra }), ok).then((x) => { if (x) setNote(""); });
  return (
    <Step n={4} title="Reset" done={["technician_completed", "evidence_collected", "reviewed"].includes(st)}>
      <p className="mb-3 text-sm">Status: <ToneBadge tone={RESET_LABEL[st]?.tone ?? "neutral"}>{RESET_LABEL[st]?.label}</ToneBadge>{r.reset_method && <> · {RESET_METHOD_LABEL[r.reset_method]}</>}</p>
      <Note tone="warning">A reset erases user data on the device. NexWipe does not perform or verify it: these buttons record the authorization and the technician’s report. A Powerwash or recovery is not a verified NIST Purge or certified erasure.</Note>
      <div className="mt-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Official procedure (check the current page before each batch):</p>
        <ol className="ml-4 mt-1 list-decimal space-y-0.5">
          <li>If the device is enrolled, the owning administrator deprovisions it first — a reset alone re-enrolls managed devices.</li>
          <li>Then Powerwash from the sign-in screen, or recover ChromeOS from recovery media if the device will not boot normally.</li>
        </ol>
        <ul className="mt-2 space-y-0.5">
          {OFFICIAL_REFERENCES.map((l) => (
            <li key={l.url}><a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">{l.label} <ExternalLink className="size-3" /></a></li>
          ))}
        </ul>
      </div>
      {(st === "not_started" || st === "failed_interrupted") && (
        <div className="mt-4 space-y-2">
          {blockers.length > 0 ? (
            <ul className="list-disc pl-5 text-sm text-warning">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          ) : canAuthorize ? (
            <>
              <Label htmlFor="cb-confirm">Type the serial number shown on the device to authorize the reset</Label>
              <div className="flex gap-2">
                <Input id="cb-confirm" value={serial} onChange={(e) => setSerial(e.target.value)} className="font-mono" autoComplete="off" />
                <Button disabled={busy || !serial} onClick={() => step("authorize", { _confirm_serial: serial }, "Reset authorized")}>Authorize reset</Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">An owner or administrator must authorize the reset.</p>
          )}
        </div>
      )}
      {canOperate && st === "authorized" && (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="w-72">
            <Label>Method being used</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{["powerwash", "recovery_media", "other"].map((k) => <SelectItem key={k} value={k}>{RESET_METHOD_LABEL[k]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Input className="min-w-48 flex-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder={method === "other" ? "Describe the method (required)" : "Notes (optional)"} />
          <Button disabled={busy} onClick={() => step("start", { _method: method, _notes: note }, "Reset started")}>Start reset</Button>
          <Button variant="outline" disabled={busy || !note.trim()} onClick={() => step("fail", { _notes: note }, "Recorded as failed / interrupted")}>Failed / interrupted</Button>
        </div>
      )}
      {canOperate && st === "in_progress" && (
        <div className="mt-4 space-y-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you saw (required if it failed)" rows={2} />
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => step("complete", { _notes: note }, "Recorded as completed by technician")}>Technician: reset completed</Button>
            <Button variant="outline" disabled={busy || !note.trim()} onClick={() => step("fail", { _notes: note }, "Recorded as failed / interrupted")}>Failed / interrupted</Button>
          </div>
        </div>
      )}
      {canOperate && (st === "technician_completed" || st === "evidence_collected") && (
        <div className="mt-4 space-y-2">
          <Label>Completion evidence collected</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Describe the evidence, e.g. photo of the welcome screen stored at …" rows={2} />
          <Button size="sm" variant="outline" disabled={busy || !note.trim()} onClick={() => step("evidence", { _notes: note }, "Evidence recorded")}>Record evidence</Button>
        </div>
      )}
    </Step>
  );
}

// ---------- 5. online setup ----------
function OnlineSetup({ r, canEdit }: { r: Rec; canEdit: boolean }) {
  const { run, busy } = useRun(r.id);
  const [online, setOnline] = useState<"" | "yes" | "no">("");
  const [prompt, setPrompt] = useState<"" | "yes" | "no">("");
  const [note, setNote] = useState("");
  const ready = ["technician_completed", "evidence_collected"].includes(r.reset_status);
  return (
    <Step n={5} title="Post-reset online setup check" done={r.online_setup_result === "no_enrollment_prompt"}>
      <p className="mb-2 text-sm">Result: {r.online_setup_result === "not_checked" ? "Not checked" : r.online_setup_result === "no_enrollment_prompt" ? <ToneBadge tone="success">No enrollment prompt (online)</ToneBadge> : <ToneBadge tone="danger">Enrollment prompt shown</ToneBadge>}{r.online_setup_checked_at && <> · {formatDateTime(r.online_setup_checked_at)}</>}</p>
      <Note>Connect to the internet and go through setup until sign-in. An offline setup screen is not evidence: forced re-enrollment only appears once the device is online.</Note>
      {canEdit && ready && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <YesNo label="Device connected to the internet during setup?" value={online} onChange={setOnline} />
          <YesNo label="Enterprise enrollment or “managed” screen shown?" value={prompt} onChange={setPrompt} />
          <Textarea className="sm:col-span-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you saw (network used, screens shown)" rows={2} />
          <Button className="w-fit" size="sm" disabled={busy || !online || !prompt}
            onClick={() => run(supabase.rpc("chromebook_online_setup_check", { _record: r.id, _online: online === "yes", _enrollment_prompt: prompt === "yes", _notes: note }), "Setup check recorded")}>
            Record setup check
          </Button>
        </div>
      )}
      {!ready && <p className="mt-2 text-xs text-muted-foreground">Available after the reset is recorded as completed.</p>}
    </Step>
  );
}

function YesNo({ label, value, onChange }: { label: string; value: string; onChange: (v: "yes" | "no") => void }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex gap-2">
        {(["yes", "no"] as const).map((v) => (
          <Button key={v} type="button" size="sm" variant={value === v ? "default" : "outline"} onClick={() => onChange(v)}>{v === "yes" ? "Yes" : "No"}</Button>
        ))}
      </div>
    </div>
  );
}

// ---------- 6. diagnostics ----------
const DIAG_LABEL: Record<DiagnosticResult, string> = { pass: "Pass", fail: "Fail", not_fitted: "Not fitted", not_tested: "Not tested" };

function Diagnostics({ r, canEdit }: { r: Rec; canEdit: boolean }) {
  const { run, busy } = useRun(r.id);
  const saved = (r.diagnostics ?? {}) as Record<string, string>;
  const [vals, setVals] = useState<Record<string, DiagnosticResult>>(() =>
    Object.fromEntries(DIAGNOSTIC_CHECKS.map((c) => [c.key, (saved[c.key] as DiagnosticResult) ?? "not_tested"])),
  );
  const [note, setNote] = useState(saved["notes"] ?? "");
  return (
    <Step n={6} title="Diagnostics (manual checks)" done={["passed", "exceptions"].includes(r.diagnostics_status)}>
      <p className="mb-3 text-xs text-muted-foreground">All checks are manual technician observations. NexWipe runs no automated hardware tests and a web page cannot read device serials, storage or management state.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {DIAGNOSTIC_CHECKS.map((c) => (
          <div key={c.key} className="flex items-center justify-between gap-2">
            <span className="text-sm">{c.label} <span className="text-xs text-muted-foreground">{c.need === "required" ? "· required" : c.need === "when_fitted" ? "· required if fitted" : "· optional"}</span></span>
            <Select value={vals[c.key] ?? "not_tested"} onValueChange={(v) => setVals((s) => ({ ...s, [c.key]: v as DiagnosticResult }))} disabled={!canEdit}>
              <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(DIAG_LABEL) as DiagnosticResult[]).map((k) => <SelectItem key={k} value={k}>{DIAG_LABEL[k]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ))}
      </div>
      <Textarea className="mt-3" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Exceptions / notes" rows={2} disabled={!canEdit} />
      {canEdit && <Button className="mt-2" size="sm" disabled={busy} onClick={() => run(supabase.rpc("chromebook_record_diagnostics", { _record: r.id, _results: vals, _notes: note }), "Diagnostics saved")}>Save diagnostics</Button>}
    </Step>
  );
}

// ---------- 7. review ----------
function Review({ r, canReview }: { r: Rec; canReview: boolean }) {
  const { run, busy } = useRun(r.id);
  const [note, setNote] = useState("");
  const { orgId } = useOrg();
  // The server decides; this list comes from the same rule the database enforces on approval.
  const server = useQuery({
    queryKey: ["chromebook-resale-check", orgId, r.id, r.updated_at],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("chromebook_resale_check", { _record: r.id });
      if (error) throw error;
      return (data ?? []) as string[];
    },
    enabled: r.release_decision === "pending",
  });
  const blockers = (server.data ?? resaleBlockers(r, note)).filter(
    (b) => b !== "Explain the optional diagnostic exceptions in the review notes" || !note.trim(),
  );
  return (
    <Step n={7} title="Review and release" done={r.release_decision !== "pending"}>
      {r.release_decision !== "pending" ? (
        <p className="text-sm">
          <ToneBadge tone={r.release_decision === "resale_ready" ? "success" : "danger"}>{r.release_decision === "resale_ready" ? "Resale-ready" : "Quarantined"}</ToneBadge>{" "}
          {formatDateTime(r.reviewed_at)} {r.review_notes && <>· {r.review_notes}</>}
        </p>
      ) : (
        <>
          {blockers.length > 0 && (
            <div className="mb-3 text-sm"><p className="font-medium">Resale-ready approval is blocked{server.data ? " (checked by the server)" : ""}:</p><ul className="list-disc pl-5 text-warning">{blockers.map((b) => <li key={b}>{b}</li>)}</ul></div>
          )}
          {canReview ? (
            <>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Review notes (required for quarantine or diagnostic exceptions)" rows={2} />
              <div className="mt-2 flex gap-2">
                <Button size="sm" disabled={busy || blockers.length > 0} onClick={() => run(supabase.rpc("chromebook_review", { _record: r.id, _decision: "resale_ready", _notes: note }), "Released as resale-ready")}>Approve resale-ready</Button>
                <Button size="sm" variant="outline" disabled={busy || !note.trim()} onClick={() => run(supabase.rpc("chromebook_review", { _record: r.id, _decision: "quarantined", _notes: note }), "Quarantined")}>Quarantine</Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">An owner or administrator reviews and releases.</p>
          )}
        </>
      )}
    </Step>
  );
}

// ---------- Processing record ----------
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="grid grid-cols-[14rem_1fr] gap-2 border-b border-border py-1.5 text-sm last:border-0"><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></div>;
}

function src(s: string | null | undefined) {
  return s ? <span className="ml-1 text-xs text-muted-foreground">({SOURCE_LABEL[s as ValueSource] ?? s})</span> : null;
}

function ProcessingRecord({ r }: { r: Rec }) {
  const members = useMembers();
  const events = useChromebookEvents(r.id);
  const who = (id: string | null) => (id ? memberName(members.data?.find((m) => m.user_id === id)) : "—");
  const d = r.devices;
  const diag = (r.diagnostics ?? {}) as Record<string, string>;
  const mgmtEvents = (events.data ?? []).filter((e) => e.step === "management" || e.step === "ownership_recorded");
  const setupEvents = (events.data ?? []).filter((e) => e.step === "online_setup_check");
  const resetEvents = (events.data ?? []).filter((e) => e.step.startsWith("reset_"));
  const unk = <span className="text-muted-foreground">Unknown</span>;
  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Chromebook Processing Record</h2>
          <p className="text-xs text-muted-foreground">Record ID <Mono>{r.id}</Mono> · generated {formatDateTime(new Date().toISOString())}</p>
        </div>
        <Button size="sm" variant="outline" className="print:hidden" onClick={() => window.print()}><Printer /> Print</Button>
      </div>
      <div className="rounded-md border border-warning/30 bg-warning-soft p-3 text-xs text-warning">
        This is a processing record, not a sanitization certificate. A Powerwash or ChromeOS recovery is not reported as a verified NIST Purge or independently certified erasure. Technician observations and administrator reports are recorded as such; no machine-generated evidence exists for this device.
        {r.is_synthetic && <strong className="block">SYNTHETIC TEST RECORD — not physical-test evidence.</strong>}
      </div>
      <section><h3 className="mb-1 font-medium">Device identification</h3><dl>
        <Row k="Asset tag" v={<Mono>{d?.asset_tag}</Mono>} />
        <Row k="Manufacturer / model" v={[d?.manufacturer, d?.model].filter(Boolean).join(" ") || unk} />
        <Row k="Serial number" v={d?.system_serial ? <Mono>{d.system_serial}</Mono> : unk} />
        <Row k="Board / platform" v={r.board ? <><Mono>{r.board}</Mono>{src(r.board_source)}</> : unk} />
        <Row k="Architecture" v={r.cpu_arch === "unknown" ? unk : <>{r.cpu_arch === "x86_64" ? "x86-64" : "ARM"}{src(r.cpu_arch_source)}</>} />
        <Row k="Storage" v={r.storage_type === "unknown" && !r.storage_capacity_gb ? unk : <>{r.storage_type === "unknown" ? "Type unknown" : r.storage_type.toUpperCase()}{src(r.storage_type_source)} {r.storage_capacity_gb ? <>· {r.storage_capacity_gb} GB{src(r.storage_capacity_source)}</> : null}</>} />
        <Row k="ChromeOS version" v={r.chromeos_version ? <>{r.chromeos_version}{src(r.chromeos_version_source)}</> : unk} />
        <Row k="Auto Update Expiration" v={r.aue_date ? <>{formatDate(r.aue_date)} <span className="text-xs text-muted-foreground">(source: {r.aue_source}; retrieved {formatDate(r.aue_retrieved_on)})</span></> : unk} />
        <Row k="Received" v={formatDateTime(d?.received_at)} />
      </dl></section>
      <section><h3 className="mb-1 font-medium">Management / deprovisioning evidence</h3><dl>
        <Row k="Ownership authorization" v={r.ownership_status === "recorded" ? <>{r.ownership_authorized_by} · ref {r.ownership_reference} · {formatDateTime(r.ownership_recorded_at)}</> : <span className="text-warning">Not recorded</span>} />
        <Row k="Management status" v={MANAGEMENT_LABEL[r.management_status as ManagementStatus]?.label} />
        <Row k="Management basis" v={r.management_basis ? MANAGEMENT_LABEL[r.management_basis as ManagementStatus]?.label : "Unresolved"} />
        {mgmtEvents.map((e) => <Row key={e.id} k={formatDateTime(e.created_at)} v={<>{e.step === "ownership_recorded" ? "Ownership authorization recorded" : MANAGEMENT_LABEL[e.to_value as ManagementStatus]?.label ?? e.step} · {EVIDENCE_KIND_LABEL[e.evidence_kind]} by {who(e.actor_id)}{e.notes && <> — {e.notes}</>}</>} />)}
      </dl></section>
      <section><h3 className="mb-1 font-medium">Reset method and evidence</h3><dl>
        <Row k="Status" v={RESET_LABEL[r.reset_status as ResetStatus]?.label} />
        <Row k="Method used" v={r.reset_method ? RESET_METHOD_LABEL[r.reset_method] : "—"} />
        <Row k="Authorized" v={<>{who(r.reset_authorized_by)} · {formatDateTime(r.reset_authorized_at)}</>} />
        <Row k="Performed by" v={<>{who(r.reset_started_by)} · started {formatDateTime(r.reset_started_at)} · completed {formatDateTime(r.reset_completed_at)}</>} />
        {resetEvents.map((e) => <Row key={e.id} k={formatDateTime(e.created_at)} v={<>{e.step.replace("reset_", "")} → {RESET_LABEL[e.to_value as ResetStatus]?.label} · {EVIDENCE_KIND_LABEL[e.evidence_kind]}{e.notes && <> — {e.notes}</>}</>} />)}
      </dl></section>
      <section><h3 className="mb-1 font-medium">Post-reset online setup observations</h3><dl>
        {setupEvents.length === 0 ? <Row k="Result" v="Not checked" /> : setupEvents.map((e) => {
          const p = e.payload as { online?: boolean; enrollment_prompt?: boolean };
          return <Row key={e.id} k={formatDateTime(e.created_at)} v={<>Online: {p.online ? "yes" : "no"} · enrollment prompt: {p.enrollment_prompt ? "shown" : "not shown"} · {EVIDENCE_KIND_LABEL[e.evidence_kind]} by {who(e.actor_id)}{e.notes && <> — {e.notes}</>}</>} />;
        })}
      </dl></section>
      <section><h3 className="mb-1 font-medium">Diagnostics (manual)</h3><dl>
        {DIAGNOSTIC_CHECKS.map((c) => <Row key={c.key} k={c.label} v={DIAG_LABEL[(diag[c.key] as DiagnosticResult) ?? "not_tested"]} />)}
        {diag["notes"] && <Row k="Notes" v={diag["notes"]} />}
      </dl></section>
      <section><h3 className="mb-1 font-medium">Technician and reviewer</h3><dl>
        <Row k="Received by" v={who(r.created_by)} />
        <Row k="Reviewer" v={<>{who(r.reviewed_by)} · {formatDateTime(r.reviewed_at)}</>} />
      </dl></section>
      <section><h3 className="mb-1 font-medium">Exceptions and release decision</h3><dl>
        <Row k="Decision" v={r.release_decision === "pending" ? "Pending" : r.release_decision === "resale_ready" ? "Resale-ready" : "Quarantined"} />
        <Row k="Review notes" v={r.review_notes ?? "—"} />
      </dl></section>
    </div>
  );
}

function History({ recordId }: { recordId: string }) {
  const events = useChromebookEvents(recordId);
  const members = useMembers();
  if (events.isLoading) return <LoadingBlock />;
  if (events.error) return <ErrorBlock error={events.error} />;
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Step</th><th className="px-3 py-2">Change</th><th className="px-3 py-2">Evidence type</th><th className="px-3 py-2">By</th><th className="px-3 py-2">Notes</th></tr>
        </thead>
        <tbody>
          {(events.data ?? []).map((e: Tables<"chromebook_events">) => (
            <tr key={e.id} className="border-b border-border last:border-0">
              <td className="whitespace-nowrap px-3 py-2">{formatDateTime(e.created_at)}</td>
              <td className="px-3 py-2"><Mono>{e.step}</Mono>{e.is_synthetic && <ToneBadge tone="warning" className="ml-2">Synthetic</ToneBadge>}</td>
              <td className="px-3 py-2 text-xs">{e.from_value || e.to_value ? `${e.from_value ?? "—"} → ${e.to_value ?? "—"}` : "—"}</td>
              <td className="px-3 py-2 text-xs">{EVIDENCE_KIND_LABEL[e.evidence_kind] ?? e.evidence_kind}</td>
              <td className="px-3 py-2 text-xs">{memberName(members.data?.find((m) => m.user_id === e.actor_id))}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{e.notes ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">History is append-only: interrupted or failed steps stay visible.</p>
    </div>
  );
}
