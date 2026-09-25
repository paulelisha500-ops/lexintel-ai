import React, { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Activity, BookOpen, CalendarDays, FileText, Gavel, GitBranch, LayoutGrid, ListTree, Mic, MoreHorizontal, Pencil, Printer, Users,
} from "lucide-react";
import { api, ApiError } from "../../../api/client";
import { useCase, useInvalidate } from "../../../api/hooks";
import { useAuth } from "../../../auth/AuthContext";
import { Alert, Badge, Button, ErrorState, Input, Select, Skeleton, Textarea } from "../../../components/ui/core";
import { PageHeader } from "../../../components/ui/data";
import { Menu, Modal, Tabs } from "../../../components/ui/overlay";
import { fmtDate } from "../../../lib/format";
import { CASE_STATUSES, label, options } from "../../../lib/labels";
import { usePrefs } from "../../../lib/prefs";
import { can } from "../../../lib/roles";
import { PriorityBadge, StatusBadge } from "../shared";
import { OverviewTab } from "./OverviewTab";
import { PartiesTab } from "./PartiesTab";
import { HearingsTab } from "./HearingsTab";
import { EvidenceTab } from "./EvidenceTab";
import { TimelineTab } from "./TimelineTab";
import { StatementsTab } from "./StatementsTab";
import { ResearchTab } from "./ResearchTab";
import { RelatedTab } from "./RelatedTab";
import { RulingTab } from "./RulingTab";
import { ActivityTab } from "./ActivityTab";

export default function CaseWorkspace() {
  const { caseId } = useParams();
  const { t, lang } = usePrefs();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "overview";
  const data = useCase(caseId);
  const [editOpen, setEditOpen] = useState(false);

  if (data.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-5 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (data.isError || !data.data) return <ErrorState error={data.error} onRetry={() => data.refetch()} />;
  const c = data.data;

  const tabs = [
    { value: "overview", label: t("Overview", "نظرة عامة"), icon: <LayoutGrid className="size-4" />, content: <OverviewTab c={c} onEdit={() => setEditOpen(true)} /> },
    { value: "parties", label: t("Parties", "الأطراف"), icon: <Users className="size-4" />, count: c.parties.length, content: <PartiesTab c={c} /> },
    { value: "hearings", label: t("Hearings", "الجلسات"), icon: <CalendarDays className="size-4" />, count: c.hearings.length, content: <HearingsTab c={c} /> },
    { value: "evidence", label: t("Evidence", "الأدلة"), icon: <FileText className="size-4" />, count: c.evidence_summary.total, content: <EvidenceTab c={c} /> },
    { value: "timeline", label: t("Timeline & analysis", "التسلسل والتحليل"), icon: <ListTree className="size-4" />, count: c.timeline.length, content: <TimelineTab c={c} /> },
    { value: "statements", label: t("Statements", "الإفادات"), icon: <Mic className="size-4" />, count: c.statement_count, content: <StatementsTab c={c} /> },
    { value: "research", label: t("Research", "البحث"), icon: <BookOpen className="size-4" />, count: c.research_note_count, content: <ResearchTab c={c} /> },
    { value: "related", label: t("Related cases", "قضايا مرتبطة"), icon: <GitBranch className="size-4" />, content: <RelatedTab c={c} /> },
    { value: "ruling", label: t("Ruling", "الحكم"), icon: <Gavel className="size-4" />, content: <RulingTab c={c} /> },
    { value: "activity", label: t("Activity", "السجل"), icon: <Activity className="size-4" />, content: <ActivityTab c={c} />, hidden: !can.viewCaseAudit(user?.role) },
  ];

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: t("Cases", "القضايا"), to: "/app/cases" }, { label: <span dir="ltr">{c.case_number}</span> }]}
        title={c.title}
        meta={
          <>
            <span className="font-mono text-sm muted" dir="ltr">{c.case_number}</span>
            <Badge tone="neutral">{label.caseType(c.case_type, lang)}</Badge>
            <StatusBadge status={c.status} />
            <PriorityBadge priority={c.priority} />
            {c.statutory_deadline && (
              <Badge tone={new Date(c.statutory_deadline) < new Date() ? "error" : "info"}>
                {t("Deadline", "المهلة")}: {fmtDate(c.statutory_deadline, lang)}
              </Badge>
            )}
            {c.ruling && <Badge tone="success" icon={<Gavel className="size-3" />}>{t("Ruling entered", "صدر الحكم")}</Badge>}
          </>
        }
        actions={
          <>
            {can.editCase(user?.role) && (
              <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => setEditOpen(true)}>
                {t("Edit", "تعديل")}
              </Button>
            )}
            <Menu
              trigger={
                <Button variant="outline" iconOnly aria-label={t("More actions", "إجراءات أخرى")}>
                  <MoreHorizontal className="size-4" />
                </Button>
              }
              items={[
                { label: t("Print case summary", "طباعة ملخص القضية"), icon: <Printer className="size-4" />, onSelect: () => window.print() },
                { label: t("Copy case link", "نسخ رابط القضية"), icon: <GitBranch className="size-4" />, onSelect: () => navigator.clipboard.writeText(window.location.href).then(() => toast.success(t("Link copied", "تم نسخ الرابط"))) },
              ]}
            />
          </>
        }
      />

      <Tabs tabs={tabs} value={tab} onValueChange={(v) => { const next = new URLSearchParams(params); next.set("tab", v); setParams(next, { replace: true }); }} />

      <EditCaseModal open={editOpen} onClose={() => setEditOpen(false)} c={c} />
    </div>
  );
}

const EditCaseModal: React.FC<{ open: boolean; onClose: () => void; c: any }> = ({ open, onClose, c }) => {
  const { t, lang } = usePrefs();
  const { user } = useAuth();
  const invalidate = useInvalidate();
  const judgeOnly = user?.role === "judge";
  const [form, setForm] = useState({ title: c.title, description: c.description ?? "", status: c.status, statutory_deadline: c.statutory_deadline ?? "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (open) setForm({ title: c.title, description: c.description ?? "", status: c.status, statutory_deadline: c.statutory_deadline ?? "" });
  }, [open, c]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = judgeOnly
        ? { status: form.status }
        : { title: form.title, description: form.description || null, status: form.status, statutory_deadline: form.statutory_deadline || null };
      await api.patch(`/cases/${c.id}`, body, { retry: false });
      await invalidate(["case", c.id], ["cases"], ["analytics"]);
      toast.success(t("Case updated", "تم تحديث القضية"));
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={t("Edit case", "تعديل القضية")} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>{t("Cancel", "إلغاء")}</Button><Button loading={saving} onClick={save}>{t("Save", "حفظ")}</Button></>}>
      <div className="grid gap-5 sm:grid-cols-2">
        {judgeOnly && <Alert tone="info" size="sm" className="sm:col-span-2">{t("Judges can change a case's status. Other details are edited by case staff.", "يمكن للقاضي تغيير حالة القضية، ويعدّل موظفو القضايا بقية التفاصيل.")}</Alert>}
        <Input fieldClassName="sm:col-span-2" label={t("Title", "العنوان")} value={form.title} disabled={judgeOnly} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Select label={t("Status", "الحالة")} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={options(CASE_STATUSES, lang)} />
        <Input label={t("Statutory deadline", "المهلة القانونية")} type="date" value={form.statutory_deadline} disabled={judgeOnly} onChange={(e) => setForm({ ...form, statutory_deadline: e.target.value })} />
        <Textarea fieldClassName="sm:col-span-2" label={t("Description", "الوصف")} rows={5} value={form.description} disabled={judgeOnly} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        {error && <Alert tone="error" className="sm:col-span-2">{error}</Alert>}
      </div>
    </Modal>
  );
};
