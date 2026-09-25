import React, { useState } from "react";
import { toast } from "sonner";
import { Gavel, Lock } from "lucide-react";
import { api, ApiError } from "../../../api/client";
import { useInvalidate, useResearchNotes } from "../../../api/hooks";
import type { CaseDetailResponse } from "../../../api/types";
import { useAuth } from "../../../auth/AuthContext";
import { Alert, Button, Card, Checkbox, EmptyState, Textarea } from "../../../components/ui/core";
import { useConfirm } from "../../../components/ui/overlay";
import { fmtDateTime } from "../../../lib/format";
import { usePrefs } from "../../../lib/prefs";
import { can } from "../../../lib/roles";

export const RulingTab: React.FC<{ c: CaseDetailResponse }> = ({ c }) => {
  const { t, lang } = usePrefs();
  const { user } = useAuth();
  const invalidate = useInvalidate();
  const notes = useResearchNotes(c.id);
  const { confirm, element } = useConfirm();
  const [text, setText] = useState(c.ruling?.ruling_text ?? "");
  const [refs, setRefs] = useState<string[]>(c.ruling?.ai_assisted_research_refs ?? []);
  const [closeCase, setCloseCase] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(!c.ruling);
  const isJudge = can.enterRuling(user?.role);

  const noteRefs = (notes.data ?? []).map((n) => ({ id: `research-note:${n.id}`, label: n.question }));

  const submit = async () => {
    if (text.trim().length < 20) return setError(t("The ruling must be at least 20 characters.", "يجب ألا يقل نص الحكم عن 20 حرفاً."));
    const ok = await confirm({
      title: c.ruling ? t("Amend the ruling?", "تعديل الحكم؟") : t("Enter this ruling?", "إدخال هذا الحكم؟"),
      body: t("The ruling will be recorded under your name and written to the audit log.", "سيُسجَّل الحكم باسمك ويُدوَّن في سجل التدقيق."),
      confirmLabel: t("Enter ruling", "إدخال الحكم"),
    });
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      await api.post(`/cases/${c.id}/ruling`, { ruling_text: text.trim(), ai_assisted_research_refs: refs, close_case: closeCase }, { retry: false });
      await invalidate(["case", c.id], ["cases"], ["analytics"]);
      toast.success(t("Ruling entered", "تم إدخال الحكم"));
      setEditing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2" title={t("Ruling", "الحكم")} subtitle={t("Entered only by a judge. No AI can write to this record.", "يُدخله القاضي فقط، ولا يمكن لأي نظام ذكاء اصطناعي الكتابة فيه.")}>
        {c.ruling && !editing ? (
          <div>
            <div className="text-sm muted">
              {t("Entered by", "أدخله")} <strong>{c.ruling.entered_by_name ?? t("a judge", "قاضٍ")}</strong> · {fmtDateTime(c.ruling.entered_at, lang)}
            </div>
            <div className="mt-4 whitespace-pre-wrap rounded-xl border border-primary-200 bg-primary-50/50 p-5 leading-relaxed" dir="auto">
              {c.ruling.ruling_text}
            </div>
            {c.ruling.ai_assisted_research_refs.length > 0 && (
              <p className="mt-3 text-xs muted">{t(`${c.ruling.ai_assisted_research_refs.length} saved research note(s) were consulted.`, `رُجع إلى ${c.ruling.ai_assisted_research_refs.length} من الأبحاث المحفوظة.`)}</p>
            )}
            {isJudge && <Button className="mt-5" variant="outline" onClick={() => setEditing(true)}>{t("Amend ruling", "تعديل الحكم")}</Button>}
          </div>
        ) : isJudge ? (
          <div className="space-y-5">
            <Textarea label={t("Ruling text", "نص الحكم")} rows={12} value={text} onChange={(e) => setText(e.target.value)} dir="auto" />
            {noteRefs.length > 0 && (
              <div>
                <div className="text-sm font-medium">{t("Research you consulted (optional)", "الأبحاث التي رجعت إليها (اختياري)")}</div>
                <div className="mt-2 space-y-2">
                  {noteRefs.map((r) => (
                    <Checkbox key={r.id} label={r.label} checked={refs.includes(r.id)}
                      onChange={(e) => setRefs((prev) => (e.target.checked ? [...prev, r.id] : prev.filter((x) => x !== r.id)))} />
                  ))}
                </div>
              </div>
            )}
            <Checkbox label={t("Mark the case as resolved", "وسم القضية بأنه تم الفصل فيها")} checked={closeCase} onChange={(e) => setCloseCase(e.target.checked)} />
            {error && <Alert tone="error">{error}</Alert>}
            <div className="flex gap-2">
              <Button loading={saving} icon={<Gavel className="size-4" />} onClick={submit}>{c.ruling ? t("Save amended ruling", "حفظ الحكم المعدّل") : t("Enter ruling", "إدخال الحكم")}</Button>
              {c.ruling && <Button variant="outline" onClick={() => { setEditing(false); setText(c.ruling!.ruling_text); }}>{t("Cancel", "إلغاء")}</Button>}
            </div>
          </div>
        ) : (
          <EmptyState icon={<Lock className="size-7" />} title={t("No ruling yet", "لم يصدر حكم بعد")} description={t("Only the judge can enter the ruling for this case.", "لا يُدخل حكم هذه القضية إلا القاضي.")} />
        )}
      </Card>
      <Card title={t("Before ruling", "قبل الحكم")}>
        <ul className="space-y-3 text-sm">
          <li>• {t(`${c.parties.length} parties on record`, `${c.parties.length} من الأطراف مسجلون`)}</li>
          <li>• {t(`${c.evidence_summary.total} evidence files (${c.evidence_summary.pending_review} pending review)`, `${c.evidence_summary.total} ملف أدلة (${c.evidence_summary.pending_review} بانتظار المراجعة)`)}</li>
          <li>• {t(`${c.statement_count ?? 0} statements`, `${c.statement_count ?? 0} إفادة`)}</li>
          <li>• {t(`${c.research_note_count} saved research notes`, `${c.research_note_count} بحث محفوظ`)}</li>
        </ul>
        {c.evidence_summary.pending_review > 0 && (
          <Alert tone="warning" size="sm" className="mt-4">{t("Some evidence hasn't been reviewed yet.", "بعض الأدلة لم تُراجع بعد.")}</Alert>
        )}
      </Card>
      {element}
    </div>
  );
};
