import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "../api/client";
import { useCases, useInvalidate, useJudges } from "../api/hooks";
import type { Hearing } from "../api/types";
import { courtNow, courtWallClockToIso, fmtDateTime, localInputToIso, toLocalInput } from "../lib/format";
import { HEARING_STATUSES, options } from "../lib/labels";
import { usePrefs } from "../lib/prefs";
import { Alert, Button, Input, Select, Textarea } from "./ui/core";
import { Modal } from "./ui/overlay";

const COURTROOMS = ["Courtroom 1A", "Courtroom 1C", "Courtroom 2A", "Courtroom 3B", "Courtroom 4B", "Courtroom 5A", "Virtual hearing room"];
const TYPES = ["Preliminary hearing", "Evidence hearing", "Main hearing", "Continuation", "Pronouncement", "Mediation session"];

export const HearingFormModal: React.FC<{
  open: boolean;
  onClose: () => void;
  caseId?: string;
  hearing?: Hearing | null;
  defaultStart?: Date | null;
}> = ({ open, onClose, caseId, hearing, defaultStart }) => {
  const { t, lang } = usePrefs();
  const invalidate = useInvalidate();
  const judges = useJudges();
  const cases = useCases({ open_only: true, limit: 200 }, { enabled: open && !caseId && !hearing });
  const [form, setForm] = useState({
    case_id: "", scheduled_at: "", duration_minutes: "60", courtroom: "", hearing_type: "", presiding_judge_id: "", notes: "", status: "scheduled",
  });
  const [conflicts, setConflicts] = useState<Hearing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Default to 09:30 tomorrow in the courthouse, whatever zone the reader is in.
    const start = defaultStart ?? (() => {
      const d = courtNow();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 30, 0, 0);
      return new Date(courtWallClockToIso(d));
    })();
    setForm({
      case_id: hearing?.case_id ?? caseId ?? "",
      scheduled_at: toLocalInput(hearing?.scheduled_at ?? start),
      duration_minutes: String(hearing?.duration_minutes ?? 60),
      courtroom: hearing?.courtroom ?? "",
      hearing_type: hearing?.hearing_type ?? "",
      presiding_judge_id: hearing?.presiding_judge_id ?? "",
      notes: hearing?.notes ?? "",
      status: hearing?.status ?? "scheduled",
    });
    setConflicts(null);
    setError(null);
  }, [open, hearing, caseId, defaultStart]);

  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setConflicts(null);
  };

  const save = async (force = false) => {
    if (!form.case_id || !form.scheduled_at) {
      setError(t("Choose a case and a date/time.", "اختر القضية والتاريخ والوقت."));
      return;
    }
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {
      scheduled_at: localInputToIso(form.scheduled_at),
      duration_minutes: Number(form.duration_minutes) || 60,
      courtroom: form.courtroom || null,
      hearing_type: form.hearing_type || null,
      presiding_judge_id: form.presiding_judge_id || null,
      notes: form.notes || null,
      force,
    };
    try {
      if (hearing) {
        await api.patch(`/hearings/${hearing.id}`, { ...body, status: form.status }, { retry: false });
        toast.success(t("Hearing updated", "تم تحديث الجلسة"));
      } else {
        await api.post("/hearings", { ...body, case_id: form.case_id }, { retry: false });
        toast.success(t("Hearing scheduled", "تمت جدولة الجلسة"));
      }
      await invalidate(["hearings"], ["case", form.case_id], ["analytics"], ["cases"]);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && (e.data as any)?.detail?.conflicts) {
        setConflicts((e.data as any).detail.conflicts);
      } else {
        setError(e instanceof ApiError ? e.message : String(e));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={hearing ? t("Edit hearing", "تعديل الجلسة") : t("Schedule a hearing", "جدولة جلسة")}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t("Cancel", "إلغاء")}</Button>
          {conflicts ? (
            <Button variant="danger" loading={saving} onClick={() => save(true)}>{t("Schedule anyway", "الجدولة رغم التعارض")}</Button>
          ) : (
            <Button loading={saving} onClick={() => save(false)}>{hearing ? t("Save changes", "حفظ التعديلات") : t("Schedule", "جدولة")}</Button>
          )}
        </>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        {!caseId && !hearing && (
          <Select fieldClassName="sm:col-span-2" label={t("Case", "القضية")} required value={form.case_id} onChange={(e) => set("case_id", e.target.value)}
            options={(cases.data?.items ?? []).map((c) => ({ value: c.id, label: `${c.case_number} — ${c.title}` }))}
            placeholder={cases.isLoading ? t("Loading…", "جارٍ التحميل…") : t("Choose a case", "اختر قضية")} />
        )}
        <Input label={t("Date & time", "التاريخ والوقت")} type="datetime-local" required value={form.scheduled_at} onChange={(e) => set("scheduled_at", e.target.value)} />
        <Select label={t("Duration", "المدة")} value={form.duration_minutes} onChange={(e) => set("duration_minutes", e.target.value)}
          options={[15, 30, 45, 60, 90, 120, 180, 240].map((m) => ({ value: String(m), label: t(`${m} minutes`, `${m} دقيقة`) }))} />
        <Select label={t("Courtroom", "القاعة")} value={form.courtroom} onChange={(e) => set("courtroom", e.target.value)}
          options={COURTROOMS.map((c) => ({ value: c, label: c }))} placeholder={t("Not set", "غير محددة")} />
        <Select label={t("Hearing type", "نوع الجلسة")} value={form.hearing_type} onChange={(e) => set("hearing_type", e.target.value)}
          options={TYPES.map((c) => ({ value: c, label: c }))} placeholder={t("Not set", "غير محدد")} />
        <Select label={t("Presiding judge", "القاضي المترئس")} value={form.presiding_judge_id} onChange={(e) => set("presiding_judge_id", e.target.value)}
          options={(judges.data ?? []).map((j) => ({ value: j.id, label: j.full_name }))} placeholder={t("Case's assigned judge", "القاضي المسند للقضية")} />
        {hearing && (
          <Select label={t("Status", "الحالة")} value={form.status} onChange={(e) => set("status", e.target.value)} options={options(HEARING_STATUSES, lang)} />
        )}
        <Textarea fieldClassName="sm:col-span-2" label={t("Notes", "ملاحظات")} rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        {conflicts && (
          <Alert tone="warning" className="sm:col-span-2" title={t("Scheduling conflict", "تعارض في الجدولة")}>
            <p>{t("This overlaps with:", "يتعارض ذلك مع:")}</p>
            <ul className="mt-2 list-disc space-y-1 ps-5">
              {conflicts.map((c) => (
                <li key={c.id}>
                  {fmtDateTime(c.scheduled_at, lang)} · {c.courtroom ?? "—"} · <span dir="ltr">{c.case_number}</span>
                  {c.judge_name ? ` · ${c.judge_name}` : ""}
                </li>
              ))}
            </ul>
          </Alert>
        )}
        {error && <Alert tone="error" className="sm:col-span-2">{error}</Alert>}
      </div>
    </Modal>
  );
};
