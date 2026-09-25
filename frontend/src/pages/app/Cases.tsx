import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { FolderKanban, Plus, Search } from "lucide-react";
import { api, ApiError } from "../../api/client";
import { useCases, useInvalidate, useJudges } from "../../api/hooks";
import type { CaseSummary } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { Alert, Button, Checkbox, EmptyState, ErrorState, Input, Select, Textarea } from "../../components/ui/core";
import { DataTable, PageHeader, Pagination, type Column } from "../../components/ui/data";
import { Modal } from "../../components/ui/overlay";
import { fmtDate, fmtRelativeDay } from "../../lib/format";
import { CASE_STATUSES, CASE_TYPES, label, options } from "../../lib/labels";
import { usePrefs } from "../../lib/prefs";
import { can } from "../../lib/roles";
import { PriorityBadge, StatusBadge } from "./shared";

const PAGE = 25;

export default function Cases() {
  const { t, lang } = usePrefs();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [debouncedQ, setDebouncedQ] = useState(q);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(id);
  }, [q]);

  const filters = {
    q: debouncedQ || undefined,
    status: params.get("status") || undefined,
    case_type: params.get("case_type") || undefined,
    priority: params.get("priority") || undefined,
    open_only: params.get("open_only") === "1" || undefined,
    mine: params.get("mine") === "1" || undefined,
    limit: PAGE,
    offset: Number(params.get("offset") ?? 0),
  };
  const cases = useCases(filters);

  const setFilter = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("offset");
    setParams(next, { replace: true });
  };

  const columns: Column<CaseSummary>[] = useMemo(
    () => [
      {
        key: "case",
        header: t("Case", "القضية"),
        sortValue: (c) => c.title.toLowerCase(),
        cell: (c) => (
          <div className="min-w-0">
            <div className="font-medium">{c.title}</div>
            <div className="text-xs muted" dir="ltr">{c.case_number}</div>
          </div>
        ),
      },
      { key: "type", header: t("Type", "النوع"), cell: (c) => label.caseType(c.case_type, lang), sortValue: (c) => c.case_type, hideOnMobile: true },
      { key: "status", header: t("Status", "الحالة"), cell: (c) => <StatusBadge status={c.status} />, sortValue: (c) => c.status },
      { key: "priority", header: t("Priority", "الأولوية"), cell: (c) => <PriorityBadge priority={c.priority} />, sortValue: (c) => c.priority?.score ?? -1 },
      {
        key: "next",
        header: t("Next hearing", "الجلسة القادمة"),
        cell: (c) => (c.next_hearing ? fmtRelativeDay(c.next_hearing, lang) : <span className="muted">—</span>),
        sortValue: (c) => c.next_hearing ?? null,
        hideOnMobile: true,
      },
      {
        key: "deadline",
        header: t("Deadline", "المهلة"),
        cell: (c) => (c.statutory_deadline ? fmtDate(c.statutory_deadline, lang) : <span className="muted">—</span>),
        sortValue: (c) => c.statutory_deadline ?? null,
        hideOnMobile: true,
      },
      {
        key: "file",
        header: t("File", "الملف"),
        cell: (c) => <span className="text-xs muted">{t(`${c.party_count ?? 0} parties · ${c.evidence_count ?? 0} evidence`, `${c.party_count ?? 0} أطراف · ${c.evidence_count ?? 0} أدلة`)}</span>,
        hideOnMobile: true,
      },
    ],
    [t, lang]
  );

  const hasFilters = ["q", "status", "case_type", "priority", "open_only", "mine"].some((k) => params.get(k));

  return (
    <div>
      <PageHeader
        title={t("Cases", "القضايا")}
        subtitle={t("Sorted by recommended priority. Open a case to see its full file.", "مرتبة حسب الأولوية الموصى بها. افتح القضية لعرض ملفها الكامل.")}
        actions={
          can.createCase(user?.role) && (
            <Button icon={<Plus className="size-4" />} onClick={() => setFilter("new", "1")}>
              {t("New case", "قضية جديدة")}
            </Button>
          )
        }
      />

      <div className="surface mb-4 grid gap-3 p-4 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <Input
          aria-label={t("Search cases", "ابحث في القضايا")}
          placeholder={t("Search title, number or description", "ابحث بالعنوان أو الرقم أو الوصف")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setFilter("q", e.target.value || null);
          }}
          prefix={<Search className="size-4" />}
        />
        <Select aria-label={t("Status", "الحالة")} value={params.get("status") ?? ""} onChange={(e) => setFilter("status", e.target.value || null)}
          options={options(CASE_STATUSES, lang)} placeholder={t("All statuses", "كل الحالات")} />
        <Select aria-label={t("Type", "النوع")} value={params.get("case_type") ?? ""} onChange={(e) => setFilter("case_type", e.target.value || null)}
          options={options(CASE_TYPES, lang)} placeholder={t("All types", "كل الأنواع")} />
        <Select aria-label={t("Priority", "الأولوية")} value={params.get("priority") ?? ""} onChange={(e) => setFilter("priority", e.target.value || null)}
          options={["high", "medium", "low", "unscored"].map((p) => ({ value: p, label: label.priority(p, lang) }))} placeholder={t("Any priority", "أي أولوية")} />
        <div className="flex flex-wrap items-center gap-4 md:col-span-4">
          <Checkbox label={t("Open cases only", "القضايا المفتوحة فقط")} checked={params.get("open_only") === "1"} onChange={(e) => setFilter("open_only", e.target.checked ? "1" : null)} />
          {user?.role === "judge" && (
            <Checkbox label={t("Assigned to me", "المسندة إليّ")} checked={params.get("mine") === "1"} onChange={(e) => setFilter("mine", e.target.checked ? "1" : null)} />
          )}
          {hasFilters && (
            <button className="text-sm text-primary-700 hover:underline" onClick={() => { setQ(""); setParams({}, { replace: true }); }}>
              {t("Clear filters", "مسح عوامل التصفية")}
            </button>
          )}
          {cases.data && <span className="ms-auto text-sm muted">{t(`${cases.data.total} cases`, `${cases.data.total} قضية`)}</span>}
        </div>
      </div>

      <div className="surface overflow-hidden">
        {cases.isError ? (
          <div className="p-5"><ErrorState error={cases.error} onRetry={() => cases.refetch()} /></div>
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={cases.data?.items}
              rowKey={(c) => c.id}
              loading={cases.isLoading}
              onRowClick={(c) => navigate(`/app/cases/${c.id}`)}
              empty={
                <EmptyState
                  icon={<FolderKanban className="size-7" />}
                  title={hasFilters ? t("No cases match these filters", "لا توجد قضايا تطابق عوامل التصفية") : t("No cases yet", "لا توجد قضايا بعد")}
                  description={!hasFilters && can.createCase(user?.role) ? t("Create a case, or open one from a citizen complaint.", "أنشئ قضية، أو افتحها من شكوى مواطن.") : undefined}
                />
              }
            />
            {cases.data && (
              <Pagination total={cases.data.total} pageSize={PAGE} offset={filters.offset} onChange={(o) => setFilter("offset", String(o))} />
            )}
          </>
        )}
      </div>

      <NewCaseModal open={params.get("new") === "1"} onClose={() => setFilter("new", null)} />
    </div>
  );
}

const NewCaseModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { t, lang } = usePrefs();
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const judges = useJudges();
  const [form, setForm] = useState({
    title: "", case_type: "", case_number: "", description: "", statutory_deadline: "", assigned_judge_id: "",
    public_safety_flag: false, vulnerable_victim: false, missing_critical_evidence: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (form.title.trim().length < 4 || !form.case_type) {
      setError(t("A title (4+ characters) and case type are required.", "العنوان (4 أحرف على الأقل) ونوع القضية مطلوبان."));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await api.post<CaseSummary>("/cases", {
        ...form,
        case_number: form.case_number.trim() || null,
        description: form.description.trim() || null,
        statutory_deadline: form.statutory_deadline || null,
        assigned_judge_id: form.assigned_judge_id || null,
      }, { retry: false });
      await invalidate(["cases"], ["analytics"]);
      toast.success(t(`Case ${created.case_number} created`, `تم إنشاء القضية ${created.case_number}`));
      onClose();
      navigate(`/app/cases/${created.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("New case", "قضية جديدة")}
      description={t("A case number is generated automatically unless you enter one.", "يُولَّد رقم القضية تلقائياً ما لم تُدخل رقماً.")}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t("Cancel", "إلغاء")}</Button>
          <Button loading={saving} onClick={submit}>{t("Create case", "إنشاء القضية")}</Button>
        </>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Input fieldClassName="sm:col-span-2" label={t("Title", "العنوان")} required value={form.title} maxLength={500} onChange={(e) => set("title", e.target.value)} />
        <Select label={t("Case type", "نوع القضية")} required value={form.case_type} onChange={(e) => set("case_type", e.target.value)} options={options(CASE_TYPES, lang)} placeholder={t("Choose…", "اختر…")} />
        <Input label={t("Case number (optional)", "رقم القضية (اختياري)")} value={form.case_number} onChange={(e) => set("case_number", e.target.value)} dir="ltr" placeholder="CR-2026-00001" />
        <Textarea fieldClassName="sm:col-span-2" label={t("Description", "الوصف")} rows={4} value={form.description} onChange={(e) => set("description", e.target.value)} />
        <Input label={t("Statutory deadline", "المهلة القانونية")} type="date" value={form.statutory_deadline} onChange={(e) => set("statutory_deadline", e.target.value)} />
        <Select label={t("Assigned judge", "القاضي المختص")} value={form.assigned_judge_id} onChange={(e) => set("assigned_judge_id", e.target.value)}
          options={(judges.data ?? []).map((j) => ({ value: j.id, label: j.full_name }))} placeholder={t("Not yet assigned", "لم يُعيَّن بعد")} />
        <div className="space-y-3 sm:col-span-2">
          <div className="text-sm font-medium">{t("Priority signals (factual only)", "مؤشرات الأولوية (وقائع فقط)")}</div>
          <Checkbox label={t("Public safety concern", "خطر على السلامة العامة")} checked={form.public_safety_flag} onChange={(e) => set("public_safety_flag", e.target.checked)} />
          <Checkbox label={t("Vulnerable victim (minor, elderly…)", "ضحية من الفئات المستضعفة (قاصر، كبير سن…)")} checked={form.vulnerable_victim} onChange={(e) => set("vulnerable_victim", e.target.checked)} />
          <Checkbox label={t("Critical evidence still missing", "أدلة جوهرية ما زالت ناقصة")} checked={form.missing_critical_evidence} onChange={(e) => set("missing_critical_evidence", e.target.checked)} />
        </div>
        {error && <Alert tone="error" className="sm:col-span-2">{error}</Alert>}
      </div>
    </Modal>
  );
};
