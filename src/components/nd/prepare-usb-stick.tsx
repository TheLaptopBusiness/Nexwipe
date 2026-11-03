import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorMessage } from "@/components/nd/page";
import { useOrg } from "@/lib/org-context";
import { zipFiles } from "@/lib/zip";
import helperPs1 from "../../../agent-handoff/windows-helper/nexwipe.ps1?raw";
import helperCmd from "../../../agent-handoff/windows-helper/Start NexWipe.cmd?raw";

type StickFile = { name: string; text: string };

// Windows tools expect CRLF line endings (batch files can misread LF-only labels and lines).
const crlf = (s: string) => s.replace(/\r?\n/g, "\r\n");

type DirHandle = { getFileHandle(n: string, o: { create: boolean }): Promise<{ createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }> };
type PickerWindow = Window & { showDirectoryPicker?: (o: { mode: "readwrite" }) => Promise<DirHandle> };

// Chrome/Edge only, and not inside an embedded frame (e.g. an editor preview), where browsers block it.
const canPickFolder = () => typeof window !== "undefined" && !!(window as PickerWindow).showDirectoryPicker && window.self === window.top;

/** Writes onto the folder the technician picks. Returns false when the browser cannot. */
async function writeToFolder(files: StickFile[]): Promise<boolean> {
  if (!canPickFolder()) return false;
  const dir = await (window as PickerWindow).showDirectoryPicker!({ mode: "readwrite" }); // AbortError when cancelled: caller handles
  for (const f of files) {
    const w = await (await dir.getFileHandle(f.name, { create: true })).createWritable();
    await w.write(f.text);
    await w.close();
  }
  return true;
}

// One zip, because browsers silently drop all but one of several downloads started together.
function download(files: StickFile[]) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([zipFiles(files)], { type: "application/zip" }));
  a.download = "NexWipe USB stick.zip";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export function PrepareUsbStick({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { orgId } = useOrg();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<StickFile[] | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function close(v: boolean) {
    if (!v) { setFiles(null); setDone(null); }
    onOpenChange(v);
  }

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const label = String(f.get("label")).trim();
    const ssid = String(f.get("ssid") ?? "").trim();
    setBusy(true);
    const { data, error } = await supabase.rpc("create_enrollment_token", { _org: orgId, _label: label, _site: null as never, _ttl_hours: Number(f.get("ttl") || 24) });
    setBusy(false);
    if (error) { toast.error(errorMessage(error)); return; }
    qc.invalidateQueries({ queryKey: ["enrollment-tokens", orgId] });
    const setup = {
      server: window.location.origin,
      enrollment_token: data as string,
      station_name: label,
      ...(ssid ? { wifi: { ssid, password: String(f.get("wifi_password") ?? "") } } : {}),
    };
    setFiles([
      { name: "Start NexWipe.cmd", text: crlf(helperCmd) },
      { name: "nexwipe.ps1", text: crlf(helperPs1) },
      { name: "nexwipe-setup.json", text: crlf(JSON.stringify(setup, null, 2) + "\n") },
    ]);
  }

  async function onWrite() {
    if (!files) return;
    try {
      if (await writeToFolder(files)) { setDone("Written to the folder you chose."); return; }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast.error(`Could not write there (${errorMessage(err)}). Downloading the files instead.`);
    }
    download(files);
    setDone("Downloaded \u201cNexWipe USB stick.zip\u201d. Open it and copy the three files inside to the top folder of the USB stick.");
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Prepare USB stick</DialogTitle>
          <DialogDescription>
            Puts the read-only NexWipe program for Windows on a USB stick. On a laptop that still starts Windows, open the stick and
            double-click <b>Start NexWipe.cmd</b>: it reports the laptop&apos;s hardware here and can restart the laptop into the NexWipe
            boot stick. It never erases or changes any disk. The stick does not need formatting.
          </DialogDescription>
        </DialogHeader>
        {!files ? (
          <form id="prepare-stick" onSubmit={onCreate} className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="stick-label">Stick name *</Label><Input id="stick-label" name="label" required maxLength={100} placeholder="e.g. Stick 1, Bench 3" /></div>
            <div className="space-y-1.5"><Label htmlFor="stick-ttl">First use within (hours)</Label><Input id="stick-ttl" name="ttl" type="number" min={1} max={168} defaultValue={24} /><p className="text-xs text-muted-foreground">The stick connects itself on the first laptop it runs on; after that it keeps working without a new token.</p></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="stick-ssid">Wi-Fi name (optional)</Label><Input id="stick-ssid" name="ssid" maxLength={32} autoComplete="off" /></div>
              <div className="space-y-1.5"><Label htmlFor="stick-pass">Wi-Fi password</Label><Input id="stick-pass" name="wifi_password" type="password" maxLength={63} autoComplete="new-password" /></div>
            </div>
            <p className="text-xs text-muted-foreground">The Wi-Fi password and the one-time token are saved as plain text on the stick. Keep the stick with your staff.</p>
          </form>
        ) : (
          <div className="space-y-3 text-sm">
            {canPickFolder() ? (
              <p>Plug in the USB stick, then choose its top folder (for example <b>E:\</b>). The three files are written straight onto it.</p>
            ) : (
              <p>This browser cannot write to a USB stick directly{typeof window !== "undefined" && window.self !== window.top ? " inside this preview" : ""}, so you get one zip file. Open it and copy the three files to the top folder of the USB stick. (Chrome or Edge in a normal tab can write to the stick directly.)</p>
            )}
            <ul className="list-disc pl-5 text-muted-foreground">{files.map((f) => <li key={f.name} className="font-mono text-xs">{f.name}</li>)}</ul>
            {done && <p className="text-success">{done}</p>}
            <p className="text-xs text-warning">The token inside works once and was not shown anywhere else. If writing fails, close this and prepare the stick again.</p>
          </div>
        )}
        <DialogFooter>
          {!files ? (
            <><Button variant="outline" onClick={() => close(false)}>Cancel</Button><Button type="submit" form="prepare-stick" loading={busy}>Create files</Button></>
          ) : (
            <><Button variant="outline" onClick={onWrite}>{done ? (canPickFolder() ? "Write again" : "Download again") : canPickFolder() ? "Choose USB stick…" : "Download zip"}</Button><Button onClick={() => close(false)}>Done</Button></>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
