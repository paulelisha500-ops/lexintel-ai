import React, { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarPlus, CalendarDays, Mic, Pencil } from "lucide-react";
import type { CaseDetailResponse, Hearing } from "../../../api/types";
import { useAuth } from "../../../auth/AuthContext";
import { HearingFormModal } from "../../../components/HearingForm";
import { Badge, Button, Card, EmptyState } from "../../../components/ui/core";
import { fmtDateTime } from "../../../lib/format";
import { label } from "../../../lib/labels";
import { usePrefs } from "../../../lib/prefs";
import { can } from "../../../lib/roles";

export const HearingsTab: React.FC<{ c: CaseDetailResponse }> = ({ c }) => {
  const { t, lang } = usePrefs();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Hearing | null>(null);
  const sorted = [...c.hearings].sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));

  return (
    <Card
      title={t("Hearings", "الجلسات")}
      actions={can.schedule(user?.role) && <Button icon={<CalendarPlus className="size-4" />} onClick={() => { setEditing(null); setOpen(true); }}>{t("Schedule hearing", "جدولة جلسة")}</Button>}
      padded={false}
    >
      {sorted.length === 0 ? (
        <EmptyState icon={<CalendarDays className="size-7" />} title={t("No hearings scheduled", "لا جلسات مجدولة")} />
      ) : (
        <ul className="divide-y divide-aeblack-50">
          {sorted.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{fmtDateTime(h.scheduled_at, lang)} · {h.duration_minutes} {t("min", "د")}</div>
                <div className="text-sm muted">{[h.hearing_type, h.courtroom].filter(Boolean).join(" · ") || "—"}</div>
                {h.notes && <div className="mt-1 text-xs muted">{h.notes}</div>}
              </div>
              <Badge tone={h.status === "in_progress" ? "warning" : h.status === "completed" ? "success" : h.status === "cancelled" ? "error" : "info"}>
                {label.hearingStatus(h.status, lang)}
              </Badge>
              {can.runStand(user?.role) && ["scheduled", "in_progress"].includes(h.status) && (
                <Link to={`/app/courtroom/${h.id}`} className="aegov-btn btn-soft btn-xs"><Mic className="size-3.5" /> {t("Open stand", "فتح المنصة")}</Link>
              )}
              {can.schedule(user?.role) && (
                <Button variant="ghost" size="xs" iconOnly aria-label={t("Edit", "تعديل")} onClick={() => { setEditing(h); setOpen(true); }}>
                  <Pencil className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <HearingFormModal open={open} onClose={() => setOpen(false)} caseId={c.id} hearing={editing} />
    </Card>
  );
};
