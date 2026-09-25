import React, { useState } from "react";
import { toast } from "sonner";
import { Gauge, RefreshCw } from "lucide-react";
import { api, ApiError } from "../../../api/client";
import { useInvalidate } from "../../../api/hooks";
import type { CaseDetailResponse } from "../../../api/types";
import { useAuth } from "../../../auth/AuthContext";
import { Alert, Button, Card, Checkbox, Input, KeyValue } from "../../../components/ui/core";
import { Modal } from "../../../components/ui/overlay";
import { fmtDate, fmtDateTime, fmtRelativeDay } from "../../../lib/format";
import { label } from "../../../lib/labels";
import { usePrefs } from "../../../lib/prefs";
import { can } from "../../../lib/roles";
import { PriorityBadge } from "../shared";
import { CaseBriefCard } from "./CaseBriefCard";

const FACTOR_LABELS: Record<string, [string, string]> = {
  public_safety_flag: ["Public safety concern", "خطر على السلامة العامة"],
  approaching_statutory_deadline: ["Statutory deadline", "المهلة القانونية"],
  vulnerable_victim: ["Vulnerable victim", "ضحية مستضعفة"],
  missing_critical_evidence: ["Missing critical evidence", "أدلة جوهرية ناقصة"],
  case_age: ["Time the case has been open", "مدة فتح القضية"],
};

export const OverviewTab: React.FC<{ c: CaseDetailResponse; onEdit: () => void }> = ({ c }) => {
  const { t, lang } = usePrefs();
  const { user } = useAuth();
  const [scoreOpen, setScoreOpen] = useState(false);
  const nextHearing = c.hearings
    .filter((h) => ["scheduled", "in_progress"].includes(h.status) && new Date(h.scheduled_at) > new Date(Date.now() - 4 * 3600e3))
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card title={t("Case details", "تفاصيل القضية")}>
          <KeyValue
            items={[
              { label: t("Case number", "رقم القضية"), value: <span dir="ltr">{c.case_number}</span> },
              { label: t("Type", "النوع"), value: label.caseType(c.case_type, lang) },
              { label: t("Status", "الحالة"), value: label.caseStatus(c.status, lang) },
              { label: t("Assigned judge", "القاضي المختص"), value: c.assigned_judge?.full_name ?? t("Not assigned", "لم يُعيَّن") },
              { label: t("Opened", "تاريخ الفتح"), value: fmtDate(c.created_at, lang) },
              { label: t("Statutory deadline", "المهلة القانونية"), value: c.statutory_deadline ? fmtDate(c.statutory_deadline, lang) : "—" },
              { label: t("Next hearing", "الجلسة القادمة"), value: nextHearing ? `${fmtRelativeDay(nextHearing.scheduled_at, lang)} · ${nextHearing.courtroom ?? ""}` : "—" },
              { label: t("Source", "المصدر"), value: c.source_complaint_id ? t("Citizen complaint", "شكوى مواطن") : t("Created by staff", "أنشأها الموظفون") },
            ]}
          />
          {c.description && (
            <div className="mt-6 border-t border-aeblack-100 pt-5">
              <div className="text-xs font-medium uppercase tracking-wide muted">{t("Description", "الوصف")}</div>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{c.description}</p>
            </div>
          )}
        </Card>

        <CaseBriefCard caseId={c.id} />

        <Card title={t("Case file at a glance", "الملف في لمحة")}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: t("Parties", "الأطراف"), value: c.parties.length },
              { label: t("Hearings", "الجلسات"), value: c.hearings.length },
              { label: t("Evidence files", "ملفات الأدلة"), value: c.evidence_summary.total },
              { label: t("Timeline events", "أحداث التسلسل"), value: c.timeline.length },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-aeblack-50 p-4">
                <div className="font-heading text-2xl font-bold">{s.value}</div>
                <div className="text-xs muted">{s.label}</div>
              </div>
            ))}
          </div>
          {c.evidence_summary.pending_review > 0 && (
            <Alert tone="warning" size="sm" className="mt-4">
              {t(`${c.evidence_summary.pending_review} evidence file(s) waiting for human review.`, `${c.evidence_summary.pending_review} من ملفات الأدلة بانتظار المراجعة البشرية.`)}
            </Alert>
          )}
        </Card>
      </div>

      <div className="space-y-6">
        <Card
          title={t("Recommended priority", "الأولوية الموصى بها")}
          actions={can.editCase(user?.role) && (
            <Button variant="soft" size="xs" icon={<RefreshCw className="size-3.5" />} onClick={() => setScoreOpen(true)}>
              {t("Re-score", "إعادة التقييم")}
            </Button>
          )}
        >
          {c.priority ? (
            <div>
              <div className="flex items-center gap-3">
                <PriorityBadge priority={c.priority} />
                <span className="text-sm muted">{t("Score", "الدرجة")} {c.priority.score.toFixed(2)}</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed">{c.priority.explanation}</p>
              <ul className="mt-4 space-y-2">
                {Object.entries(c.priority.factors).map(([k, v]) => (
                  <li key={k} className="flex items-center justify-between gap-2 text-sm">
                    <span className={v === 0 ? "muted" : ""}>{lang === "ar" ? FACTOR_LABELS[k]?.[1] : FACTOR_LABELS[k]?.[0] ?? k}</span>
                    <span className={`tabular-nums ${v > 0 ? "text-aered-700" : v < 0 ? "text-techblue-700" : "muted"}`}>
                      {v > 0 ? "+" : ""}{v.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs muted">
                {t("Updated", "آخر تحديث")} {fmtDateTime(c.priority.generated_at, lang)}.{" "}
                {t("This ranks workload only and says nothing about the merits.", "هذا ترتيب لعبء العمل فقط ولا يتعلق بموضوع القضية.")}
              </p>
            </div>
          ) : (
            <p className="text-sm muted">{t("Not scored yet.", "لم يُقيَّم بعد.")}</p>
          )}
        </Card>
      </div>

      <PriorityModal open={scoreOpen} onClose={() => setScoreOpen(false)} c={c} />
    </div>
  );
};

const PriorityModal: React.FC<{ open: boolean; onClose: () => void; c: CaseDetailResponse }> = ({ open, onClose, c }) => {
  const { t } = usePrefs();
  const invalidate = useInvalidate();
  const s = (c.priority_signals ?? {}) as Record<string, any>;
  const [form, setForm] = useState({
    public_safety_flag: !!s.public_safety_flag, vulnerable_victim: !!s.vulnerable_victim,
    missing_critical_evidence: !!s.missing_critical_evidence, statutory_deadline: c.statutory_deadline ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.post(`/cases/${c.id}/priority`, { ...form, statutory_deadline: form.statutory_deadline || null }, { retry: false });
      await invalidate(["case", c.id], ["cases"], ["analytics"]);
      toast.success(t("Priority updated", "تم تحديث الأولوية"));
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={t("Re-score priority", "إعادة تقييم الأولوية")}
      description={t("Only factual signals are used. The case's age is added automatically.", "تُستخدم المؤشرات الواقعية فقط، وتُضاف مدة القضية تلقائياً.")}
      footer={<><Button variant="outline" onClick={onClose}>{t("Cancel", "إلغاء")}</Button><Button loading={saving} icon={<Gauge className="size-4" />} onClick={save}>{t("Calculate", "احسب")}</Button></>}>
      <div className="space-y-4">
        <Checkbox label={t("Public safety concern", "خطر على السلامة العامة")} checked={form.public_safety_flag} onChange={(e) => setForm({ ...form, public_safety_flag: e.target.checked })} />
        <Checkbox label={t("Vulnerable victim", "ضحية مستضعفة")} checked={form.vulnerable_victim} onChange={(e) => setForm({ ...form, vulnerable_victim: e.target.checked })} />
        <Checkbox label={t("Critical evidence still missing", "أدلة جوهرية ما زالت ناقصة")} description={t("Flags the case for human review.", "يضع القضية تحت المراجعة البشرية.")} checked={form.missing_critical_evidence} onChange={(e) => setForm({ ...form, missing_critical_evidence: e.target.checked })} />
        <Input label={t("Statutory deadline", "المهلة القانونية")} type="date" value={form.statutory_deadline} onChange={(e) => setForm({ ...form, statutory_deadline: e.target.value })} />
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
};
