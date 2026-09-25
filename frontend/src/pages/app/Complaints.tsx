import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Bot, CheckCircle2, FolderPlus, Inbox, RefreshCw, Search } from "lucide-react";
import { api, ApiError } from "../../api/client";
import { useComplaints, useInvalidate } from "../../api/hooks";
import type { CaseSummary, Complaint } from "../../api/types";
import { LocalAIBadge, ProbabilityBars } from "../../components/ai/AI";
import { Alert, Badge, Button, EmptyState, ErrorState, Input, KeyValue, Select, Spinner, Textarea } from "../../components/ui/core";
import { DataTable, PageHeader, type Column } from "../../components/ui/data";
import { Drawer, Modal } from "../../components/ui/overlay";
import { fmtAgo, fmtDateTime } from "../../lib/format";
import { CASE_TYPES, COMPLAINT_STATUSES, HEARING_ROLES, label, options } from "../../lib/labels";
import { usePrefs } from "../../lib/prefs";

const STATUS_TONE: Record<string, "info" | "warning" | "success" | "neutral" | "error"> = {
  received: "warning", under_review: "info", case_opened: "success", resolved: "success", rejected: "neutral", duplicate: "neutral",
};

export default function Complaints() {
  const { t, lang } = usePrefs();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDq(q), 300);
    return () => clearTimeout(id);
  }, [q]);
  const status = params.get("status") ?? "";
  const caseType = params.get("case_type") ?? "";
  const list = useComplaints({ status: status || undefined, case_type: caseType || undefined, q: dq || undefined });
  const openId = params.get("open");
  const open = list.data?.items.find((c) => c.id === openId) ?? null;

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const columns: Column<Complaint>[] = useMemo(() => [
    {
      key: "ref", header: t("Reference", "المرجع"), sortValue: (c) => c.reference_number ?? "",
      cell: (c) => (
        <div>
          <div className="font-mono text-sm font-medium" dir="ltr">{c.reference_number}</div>
          <div className="text-xs muted">{fmtAgo(c.submitted_at, lang)}</div>
        </div>
      ),
    },
    { key: "desc", header: t("Complaint", "الشكوى"), cell: (c) => <p className="line-clamp-2 max-w-md text-sm" dir="auto">{c.description}</p> },
    {
      key: "ai", header: t("Suggested", "المقترح"),
      cell: (c) => c.ai_status === "pending" ? <Spinner label={t("Triaging…", "جارٍ الفرز…")} /> : (
        <div className="space-y-1">
          <Badge tone={c.ai_suggested_category && c.ai_suggested_category !== c.case_type ? "warning" : "neutral"}>
            {label.caseType(c.ai_suggested_category ?? c.case_type, lang)}
          </Badge>
          {c.ai_duplicate_of && <Badge tone="error">{t("Possible duplicate", "مكررة محتملة")}</Badge>}
        </div>
      ),
    },
    { key: "status", header: t("Status", "الحالة"), sortValue: (c) => c.status, cell: (c) => <Badge tone={STATUS_TONE[c.status] ?? "neutral"}>{label.complaintStatus(c.status, lang)}</Badge> },
  ], [t, lang]);

  return (
    <div>
      <PageHeader
        title={t("Complaints", "الشكاوى")}
        subtitle={t("Citizen complaints with AI triage suggestions. A person confirms every decision.", "شكاوى المواطنين مع اقتراحات الفرز الآلي، ويؤكد الموظف كل قرار.")}
      />
      <div className="surface mb-4 grid gap-3 p-4 md:grid-cols-[2fr_1fr_1fr]">
        <Input aria-label={t("Search", "بحث")} placeholder={t("Search text, reference, name, location", "ابحث في النص أو المرجع أو الاسم أو الموقع")} prefix={<Search className="size-4" />} value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label={t("Status", "الحالة")} value={status} onChange={(e) => setParam("status", e.target.value || null)} options={options(COMPLAINT_STATUSES, lang)} placeholder={t("All statuses", "كل الحالات")} />
        <Select aria-label={t("Type", "النوع")} value={caseType} onChange={(e) => setParam("case_type", e.target.value || null)} options={options(CASE_TYPES, lang)} placeholder={t("All types", "كل الأنواع")} />
      </div>
      <div className="surface overflow-hidden">
        {list.isError ? <div className="p-5"><ErrorState error={list.error} onRetry={() => list.refetch()} /></div> : (
          <DataTable columns={columns} rows={list.data?.items} rowKey={(c) => c.id} loading={list.isLoading}
            onRowClick={(c) => setParam("open", c.id)}
            empty={<EmptyState icon={<Inbox className="size-7" />} title={t("No complaints", "لا توجد شكاوى")} />} />
        )}
      </div>
      <ComplaintDrawer complaint={open} onClose={() => setParam("open", null)} />
    </div>
  );
}

const ComplaintDrawer: React.FC<{ complaint: Complaint | null; onClose: () => void }> = ({ complaint, onClose }) => {
  const { t, lang } = usePrefs();
  const invalidate = useInvalidate();
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [department, setDepartment] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [openCase, setOpenCase] = useState(false);

  useEffect(() => {
    if (!complaint) return;
    setStatus(complaint.status);
    setCategory(complaint.category_confirmed ? complaint.case_type : complaint.ai_suggested_category ?? complaint.case_type);
    setDepartment(complaint.assigned_department ?? complaint.ai_suggested_department ?? "");
    setNotes(complaint.staff_notes ?? "");
  }, [complaint?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!complaint) return <Drawer open={false} onOpenChange={() => {}} title="" />;

  const save = async () => {
    setSaving(true);
    try {
      // Saving confirms the category shown -- the classifier learns from staff decisions.
      const body: Record<string, unknown> = { assigned_department: department || null, staff_notes: notes || null, case_type: category };
      if (status !== complaint.status) body.status = status;
      await api.patch(`/complaints/${complaint.id}`, body, { retry: false });
      await invalidate(["complaints"], ["analytics"]);
      toast.success(t("Saved", "تم الحفظ"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const reclassify = async () => {
    try {
      await api.post(`/complaints/${complaint.id}/reclassify`);
      await invalidate(["complaints"]);
      toast.success(t("Triage restarted", "أُعيد الفرز"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={<span dir="ltr">{complaint.reference_number}</span>}
      footer={
        <>
          {!complaint.case_id && (
            <Button variant="soft" icon={<FolderPlus className="size-4" />} onClick={() => setOpenCase(true)}>{t("Open a case", "فتح قضية")}</Button>
          )}
          <Button loading={saving} onClick={save}>{t("Save", "حفظ")}</Button>
        </>
      }>
      <div className="space-y-6">
        <div>
          <div className="text-xs muted">{fmtDateTime(complaint.submitted_at, lang)} · {t("Citizen chose", "اختيار المواطن")}: {label.caseType(complaint.case_type, lang)}</div>
          <p className="mt-2 whitespace-pre-wrap rounded-xl bg-aeblack-50 p-4 text-sm leading-relaxed" dir="auto">{complaint.description}</p>
        </div>

        <KeyValue items={[
          { label: t("Name", "الاسم"), value: complaint.complainant_name },
          { label: t("Phone", "الهاتف"), value: complaint.complainant_phone && <span dir="ltr">{complaint.complainant_phone}</span> },
          { label: t("Email", "البريد"), value: complaint.complainant_email },
          { label: t("Location", "الموقع"), value: complaint.location },
        ]} />

        <section className="rounded-xl border border-primary-200 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold"><Bot className="size-4 text-primary-600" /> {t("Triage suggestion", "اقتراح الفرز")}</div>
            <Button variant="ghost" size="xs" icon={<RefreshCw className="size-3.5" />} onClick={reclassify}>{t("Run again", "إعادة")}</Button>
          </div>
          {complaint.ai_status === "pending" ? (
            <Spinner className="mt-3" label={t("Triaging…", "جارٍ الفرز…")} />
          ) : complaint.ai_status === "failed" ? (
            <Alert tone="error" size="sm" className="mt-3">{complaint.ai_explanation}</Alert>
          ) : (
            <div className="mt-3 space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="gold">{label.caseType(complaint.ai_suggested_category, lang)}</Badge>
                {complaint.ai_confidence != null && <Badge tone="neutral">{t("Confidence", "الثقة")} {Math.round(complaint.ai_confidence * 100)}%</Badge>}
                {complaint.ai_priority_level && <Badge tone={complaint.ai_priority_level === "high" ? "error" : complaint.ai_priority_level === "medium" ? "warning" : "neutral"}>{label.priority(complaint.ai_priority_level, lang)}</Badge>}
                {complaint.ai_status === "done"
                  ? <LocalAIBadge label={t("Meaning model", "نموذج المعنى")} />
                  : <Badge tone="neutral">{t("Keyword-based", "بالكلمات المفتاحية")}</Badge>}
              </div>
              <div><span className="muted">{t("Department", "الجهة")}:</span> {complaint.ai_suggested_department ?? "—"}</div>
              {complaint.ai_explanation && <p className="muted">{complaint.ai_explanation}</p>}
              {complaint.ai_details?.probabilities && (
                <details className="rounded-lg bg-aeblack-50/70 p-3">
                  <summary className="cursor-pointer text-xs font-semibold">{t("Why this suggestion", "سبب هذا الاقتراح")}</summary>
                  <div className="mt-3 space-y-3">
                    <ProbabilityBars values={complaint.ai_details.probabilities} label={(k) => label.caseType(k, lang)} />
                    {!!complaint.ai_details.neighbours?.length && (
                      <div>
                        <div className="mb-1 text-xs font-semibold muted">{t("Closest earlier complaints", "أقرب الشكاوى السابقة")}</div>
                        <ul className="space-y-1.5 text-xs">
                          {complaint.ai_details.neighbours.map((n, i) => (
                            <li key={i} className="flex gap-2">
                              <Badge tone="neutral">{label.caseType(n.category, lang)}</Badge>
                              <span className="flex-1" dir="auto">“{n.text}”</span>
                              <span className="shrink-0 tabular-nums muted">{Math.round(n.similarity * 100)}%{n.source === "staff decision" ? ` · ${t("staff", "موظف")}` : ""}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {complaint.ai_details.learned_examples != null && (
                      <p className="text-xs muted">{t(`Learns from staff decisions: ${complaint.ai_details.learned_examples} so far.`, `يتعلم من قرارات الموظفين: ${complaint.ai_details.learned_examples} حتى الآن.`)}</p>
                    )}
                  </div>
                </details>
              )}
              {!!complaint.duplicate_candidates?.length && (
                <div>
                  <div className="font-medium">{t("Similar complaints", "شكاوى مشابهة")}</div>
                  <ul className="mt-1 space-y-1">
                    {complaint.duplicate_candidates.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-2">
                        <span className="font-mono" dir="ltr">{d.reference_number}</span>
                        {d.meaning != null && <Badge tone={d.meaning >= 0.7 ? "warning" : "neutral"}>{t("same meaning", "نفس المعنى")} {Math.round(d.meaning * 100)}%</Badge>}
                        {d.wording != null && <span className="text-xs muted">{t("shared words", "كلمات مشتركة")} {Math.round(d.wording * 100)}%</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        {complaint.case_id ? (
          <Alert tone="success" size="sm" title={t("A case was opened", "فُتحت قضية")}>
            <Link to={`/app/cases/${complaint.case_id}`} className="underline">{t("Go to the case", "الانتقال إلى القضية")}</Link>
          </Alert>
        ) : (
          <div className="grid gap-5">
            <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto]">
              <Select label={t("Category (your decision)", "الفئة (قرارك)")} value={category} onChange={(e) => setCategory(e.target.value)}
                options={options(CASE_TYPES, lang)}
                hint={complaint.category_confirmed ? t("Confirmed by staff.", "أكدها موظف.") : t("Saving confirms it and teaches the classifier.", "الحفظ يؤكدها ويعلّم المصنِّف.")} />
              {complaint.ai_suggested_category && complaint.ai_suggested_category !== category && (
                <Button variant="soft" size="sm" icon={<CheckCircle2 className="size-4" />} onClick={() => setCategory(complaint.ai_suggested_category!)}>
                  {t("Use suggestion", "استخدام الاقتراح")}
                </Button>
              )}
            </div>
            <Select label={t("Status", "الحالة")} value={status} onChange={(e) => setStatus(e.target.value)}
              options={options(COMPLAINT_STATUSES, lang).filter((o) => o.value !== "case_opened")} />
            <Input label={t("Assigned department", "الجهة المختصة")} value={department} onChange={(e) => setDepartment(e.target.value)} />
            <Textarea label={t("Internal notes (not visible to the citizen)", "ملاحظات داخلية (لا يراها المواطن)")} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        )}
      </div>
      <OpenCaseModal complaint={complaint} open={openCase} onClose={() => setOpenCase(false)} onOpened={(id) => navigate(`/app/cases/${id}`)} />
    </Drawer>
  );
};

const OpenCaseModal: React.FC<{ complaint: Complaint; open: boolean; onClose: () => void; onOpened: (id: string) => void }> = ({ complaint, open, onClose, onOpened }) => {
  const { t, lang } = usePrefs();
  const invalidate = useInvalidate();
  const [title, setTitle] = useState("");
  const [type, setType] = useState(complaint.ai_suggested_category ?? complaint.case_type);
  const [deadline, setDeadline] = useState("");
  const [addAs, setAddAs] = useState("plaintiff");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (title.trim().length < 4) return setError(t("Give the case a title (4+ characters).", "أدخل عنواناً للقضية (4 أحرف على الأقل)."));
    setSaving(true);
    setError(null);
    try {
      const r = await api.post<{ case: CaseSummary }>(`/complaints/${complaint.id}/open-case`, {
        title: title.trim(), case_type: type, statutory_deadline: deadline || null, add_complainant_as: complaint.complainant_name ? addAs : null,
      }, { retry: false });
      await invalidate(["complaints"], ["cases"], ["analytics"]);
      toast.success(t(`Case ${r.case.case_number} opened`, `فُتحت القضية ${r.case.case_number}`));
      onClose();
      onOpened(r.case.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={t("Open a case from this complaint", "فتح قضية من هذه الشكوى")}
      footer={<><Button variant="outline" onClick={onClose}>{t("Cancel", "إلغاء")}</Button><Button loading={saving} onClick={save}>{t("Open case", "فتح القضية")}</Button></>}>
      <div className="grid gap-5">
        <Input label={t("Case title", "عنوان القضية")} required value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Select label={t("Case type", "نوع القضية")} value={type} onChange={(e) => setType(e.target.value)} options={options(CASE_TYPES, lang)} />
          <Input label={t("Statutory deadline", "المهلة القانونية")} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
        {complaint.complainant_name && (
          <Select label={t(`Add ${complaint.complainant_name} as`, `إضافة ${complaint.complainant_name} بصفة`)} value={addAs} onChange={(e) => setAddAs(e.target.value)} options={options(HEARING_ROLES, lang)} />
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
};
