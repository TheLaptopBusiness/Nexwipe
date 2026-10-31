import { FlaskConical, RadioTower } from "lucide-react";
import { ToneBadge } from "@/components/nd/status-badge";
import { hardwareOriginLabel, type HardwareOriginInput } from "@/lib/hardware-origin";

export function HardwareOriginBadge({ record, showExplanation = false }: { record: HardwareOriginInput; showExplanation?: boolean }) {
  const l = hardwareOriginLabel(record);
  const icon = record.hardware_origin === "synthetic" ? FlaskConical : record.hardware_origin === "station_reported" ? RadioTower : undefined;
  return (
    <span title={l.explanation} className="inline-flex flex-col gap-1">
      {icon ? <ToneBadge tone={l.tone} icon={icon}>{l.label}</ToneBadge> : <ToneBadge tone={l.tone}>{l.label}</ToneBadge>}
      {showExplanation && <span className="max-w-md text-xs text-muted-foreground">{l.explanation}</span>}
    </span>
  );
}
