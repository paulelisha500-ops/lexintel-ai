import React, { useState } from "react";
import { toast } from "sonner";
import { CalendarPlus, GitCompare, ScanText, Sparkles, Trash2 } from "lucide-react";
import { api, ApiError } from "../../../api/client";
import { useCaseEvidence, useCaseStatements, useInvalidate } from "../../../api/hooks";
import type { CaseDetailResponse, Entity, LegalReference, OffenceMention } from "../../../api/types";
import { useAuth } from "../../../auth/AuthContext";
import { LegalReferences, LocalAIBadge, OffenceMentions } from "../../../components/ai/AI";
import { Alert, Badge, Button, Card, EmptyState, Input, Select, Textarea } from "../../../components/ui/core";
import { Modal } from "../../../components/ui/overlay";
import { fmtDate } from "../../../lib/format";
import { usePrefs } from "../../../lib/prefs";
import { can } from "../../../lib/roles";

export const TimelineTab: React.FC<{ c: CaseDetailResponse }> = ({ c }) => {
  const { t, lang } = usePrefs();
  const { user } = useAuth();
  const invalidate = useInvalidate();
  const [addOpen, setAddOpen] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);

  const events = [...c.timeline].sort((a, b) => {
    if (!a.event_date && !b.event_date) return 0;
    if (!a.event_date) return 1;
    if (!b.event_date) return -1;
    return a.event_date.localeCompare(b.event_date);
  });

  const remove = async (id: string) => {
    try {
      await api.del(`/cases/${c.id}/timeline/${id}`);
      await invalidate(["case", c.id]);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card
        className="lg:col-span-2"
        title={t("Case timeline", "التسلسل الزمني للقضية")}
        subtitle={t("Built automatically from evidence and statements, plus events staff add.", "يُبنى آلياً من الأدلة والإفادات، إضافة إلى ما يضيفه الموظفون.")}
        actions={can.editCase(user?.role) && <Button variant="outline" icon={<CalendarPlus className="size-4" />} onClick={() => setAddOpen(true)}>{t("Add event", "إضافة حدث")}</Button>}
      >
        {events.length === 0 ? (
          <EmptyState title={t("No events yet", "لا أحداث بعد")} description={t("Upload evidence or analyse a document to build the timeline.", "ارفع أدلة أو حلّل مستنداً لبناء التسلسل الزمني.")} />
        ) : (
          <ol className="relative space-y-6 border-s-2 border-primary-100 ps-6">
            {events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -start-[31px] top-1 size-3.5 rounded-full border-2 border-whitely-50 bg-primary-600" />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{e.event_date ? fmtDate(e.event_date, lang) : t("Date not stated", "تاريخ غير محدد")}</span>
                  {e.source_label && <Badge tone="neutral">{e.source_label}</Badge>}
                  {e.entity_type === "manual" && <Badge tone="info">{t("Added by staff", "أضافه الموظفون")}</Badge>}
                </div>
                <p className="mt-1 text-sm leading-relaxed" dir="auto">{e.description}</p>
                {can.createCase(user?.role) && (
                  <button onClick={() => remove(e.id)} className="mt-1 inline-flex items-center gap-1 text-xs text-aered-600 hover:underline">
                    <Trash2 className="size-3" /> {t("Remove", "إزالة")}
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <div className="space-y-6">
        <Card title={t("Analyse a document", "تحليل مستند")}>
          <p className="text-sm muted">
            {t("Paste text (a report, a letter, a transcript). People, places, dates, amounts and named charges are extracted, and dated events are added to the timeline.",
              "الصق نصاً (تقرير، رسالة، محضر). تُستخرج الأسماء والأماكن والتواريخ والمبالغ والتهم المذكورة، وتُضاف الأحداث المؤرخة إلى التسلسل.")}
          </p>
          <Button className="mt-4" variant="soft" icon={<ScanText className="size-4" />} disabled={!can.editCase(user?.role)} onClick={() => setExtractOpen(true)}>
            {t("Analyse text", "تحليل نص")}
          </Button>
        </Card>
        <Card title={t("Compare two sources", "مقارنة مصدرين")}>
          <p className="text-sm muted">
            {t("Lists facts (dates, places, amounts, people) that two documents or statements state differently. It never judges who is truthful.",
              "يعرض الوقائع (التواريخ والأماكن والمبالغ والأشخاص) التي يذكرها مستندان أو إفادتان بشكل مختلف، دون الحكم على الصدق.")}
          </p>
          <Button className="mt-4" variant="soft" icon={<GitCompare className="size-4" />} onClick={() => setCompareOpen(true)}>
            {t("Compare", "مقارنة")}
          </Button>
        </Card>
      </div>

      <AddEventModal open={addOpen} onClose={() => setAddOpen(false)} caseId={c.id} />
      <ExtractModal open={extractOpen} onClose={() => setExtractOpen(false)} caseId={c.id} />
      <CompareModal open={compareOpen} onClose={() => setCompareOpen(false)} caseId={c.id} />
    </div>
  );
};

const AddEventModal: React.FC<{ open: boolean; onClose: () => void; caseId: string }> = ({ open, onClose, caseId }) => {
  const { t } = usePrefs();
  const invalidate = useInvalidate();
  const [date, setDate] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (desc.trim().length < 3) return setError(t("Describe the event.", "صف الحدث."));
    setSaving(true);
    try {
      await api.post(`/cases/${caseId}/timeline`, { event_date: date || null, description: desc.trim() }, { retry: false });
      await invalidate(["case", caseId]);
      setDate(""); setDesc(""); setError(null);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={t("Add timeline event", "إضافة حدث")}
      footer={<><Button variant="outline" onClick={onClose}>{t("Cancel", "إلغاء")}</Button><Button loading={saving} onClick={save}>{t("Add", "إضافة")}</Button></>}>
      <div className="space-y-5">
        <Input label={t("Date (optional)", "التاريخ (اختياري)")} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Textarea label={t("What happened", "ما الذي حدث")} rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
};

const ExtractModal: React.FC<{ open: boolean; onClose: () => void; caseId: string }> = ({ open, onClose, caseId }) => {
  const { t } = usePrefs();
  const invalidate = useInvalidate();
  const [labelText, setLabel] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ entities: Entity[]; offence_mentions: OffenceMention[]; legal_references: LegalReference[]; timeline_events: any[]; warnings: string[]; ai_used: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (text.trim().length < 10 || labelText.trim().length < 2) return setError(t("Add a label and some text.", "أضف وصفاً ونصاً."));
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<any>(`/cases/${caseId}/extract`, { document_label: labelText.trim(), raw_text: text }, { timeoutMs: 180_000, retry: false });
      setResult(r);
      await invalidate(["case", caseId]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) { setResult(null); onClose(); } }} title={t("Analyse text", "تحليل نص")} size="lg"
      footer={<><Button variant="outline" onClick={() => { setResult(null); onClose(); }}>{t("Close", "إغلاق")}</Button><Button loading={busy} icon={<Sparkles className="size-4" />} onClick={run}>{t("Analyse", "تحليل")}</Button></>}>
      <div className="space-y-5">
        <Input label={t("Document label", "وصف المستند")} placeholder={t("e.g. Witness letter", "مثال: رسالة شاهد")} value={labelText} onChange={(e) => setLabel(e.target.value)} />
        <Textarea label={t("Text", "النص")} rows={8} value={text} onChange={(e) => setText(e.target.value)} dir="auto" />
        {error && <Alert tone="error">{error}</Alert>}
        {result && (
          <div className="space-y-3">
            {result.warnings.map((w) => <Alert key={w} tone="info" size="sm">{w}</Alert>)}
            <Alert tone="success" size="sm">
              {t(`${result.entities.length} details extracted, ${result.timeline_events.length} dated events added to the timeline.`,
                `استُخرج ${result.entities.length} تفصيلاً وأضيف ${result.timeline_events.length} حدثاً مؤرخاً إلى التسلسل.`)}
            </Alert>
            <LegalReferences references={result.legal_references} />
            <OffenceMentions mentions={result.offence_mentions} />
            <div className="flex flex-wrap gap-1.5">
              {result.entities.filter((e) => !["CHARGE", "LEGAL_REF"].includes(e.label)).slice(0, 40).map((e, i) => <Badge key={i} tone="neutral">{e.label}: {e.text}</Badge>)}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

const CompareModal: React.FC<{ open: boolean; onClose: () => void; caseId: string }> = ({ open, onClose, caseId }) => {
  const { t } = usePrefs();
  const evidence = useCaseEvidence(open ? caseId : undefined);
  const statements = useCaseStatements(open ? caseId : undefined);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const sources = [
    ...(evidence.data ?? []).filter((e) => e.processing_status === "done" && (e.text_length ?? 0) > 20)
      .map((e) => ({ value: `evidence:${e.id}`, label: `${t("Evidence", "دليل")}: ${e.label}` })),
    ...(statements.data ?? []).filter((s) => (s.transcript ?? "").length > 20)
      .map((s) => ({ value: `statement:${s.id}`, label: `${t("Statement", "إفادة")}: ${s.person_name ?? s.role}` })),
  ];

  const run = async () => {
    if (!a || !b || a === b) return setError(t("Choose two different sources.", "اختر مصدرين مختلفين."));
    setBusy(true);
    setError(null);
    try {
      setResult(await api.post(`/cases/${caseId}/compare`, { source_a: a, source_b: b }, { timeoutMs: 180_000, retry: false }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) { setResult(null); onClose(); } }} title={t("Compare two sources", "مقارنة مصدرين")} size="xl"
      footer={<><Button variant="outline" onClick={() => { setResult(null); onClose(); }}>{t("Close", "إغلاق")}</Button><Button loading={busy} icon={<GitCompare className="size-4" />} onClick={run}>{t("Compare", "مقارنة")}</Button></>}>
      <div className="space-y-5">
        {sources.length < 2 && (
          <Alert tone="info" size="sm">{t("You need at least two processed evidence files or transcribed statements.", "تحتاج إلى ملفي أدلة معالجين أو إفادتين مفرّغتين على الأقل.")}</Alert>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <Select label={t("Source A", "المصدر أ")} value={a} onChange={(e) => setA(e.target.value)} options={sources} placeholder={t("Choose…", "اختر…")} />
          <Select label={t("Source B", "المصدر ب")} value={b} onChange={(e) => setB(e.target.value)} options={sources} placeholder={t("Choose…", "اختر…")} />
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        {result && (
          <div className="space-y-4">
            <Alert tone="info" size="sm">{result.disclaimer}</Alert>
            {result.ai_summary && <p className="text-sm">{result.ai_summary}</p>}
            {result.ai_differences.length > 0 && (
              <div className="overflow-x-auto">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  {t("Same point, different figures", "النقطة نفسها بأرقام مختلفة")} <LocalAIBadge label={t("Meaning model", "نموذج المعنى")} />
                </div>
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-aeblack-100">
                    <th className="py-2 text-start muted">{t("Differs", "الاختلاف")}</th>
                    <th className="py-2 text-start muted">{result.source_a}</th>
                    <th className="py-2 text-start muted">{result.source_b}</th>
                  </tr></thead>
                  <tbody>
                    {result.ai_differences.map((d: any, i: number) => (
                      <tr key={i} className="border-b border-aeblack-50 align-top">
                        <td className="py-2 pe-3 font-medium">{d.topic}</td>
                        <td className="py-2 pe-3" dir="auto">“{d.source_a}”</td>
                        <td className="py-2" dir="auto">“{d.source_b}”</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div>
              <div className="text-sm font-medium">{t("Details found in only one source", "تفاصيل وردت في مصدر واحد فقط")}</div>
              {result.detail_differences.length === 0 ? (
                <p className="mt-1 text-sm muted">{t("None — both sources mention the same dates, places and amounts.", "لا شيء — يذكر المصدران التواريخ والأماكن والمبالغ نفسها.")}</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {result.detail_differences.slice(0, 30).map((d: any, i: number) => (
                    <li key={i} className="rounded-lg bg-aeblack-50 p-3 text-sm">
                      <Badge tone="neutral">{d.label}</Badge> <strong>{d.value}</strong> — {t("only in", "فقط في")} {d.present_in}
                      <div className="mt-1 text-xs muted" dir="auto">…{d.context}…</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {!result.ai_used && <p className="text-xs muted">{t("The meaning model is unavailable, so sentences could not be paired; showing the detail check only.", "نموذج المعنى غير متاح، لذا لم تُقارن الجمل؛ يُعرض فحص التفاصيل فقط.")}</p>}
          </div>
        )}
      </div>
    </Modal>
  );
};
