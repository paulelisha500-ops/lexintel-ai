import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ScrollText, Search } from "lucide-react";
import { useAudit } from "../../../api/hooks";
import type { AuditEntry } from "../../../api/types";
import { Badge, EmptyState, ErrorState, Input, Select } from "../../../components/ui/core";
import { DataTable, PageHeader, Pagination, type Column } from "../../../components/ui/data";
import { fmtDateTime } from "../../../lib/format";
import { label } from "../../../lib/labels";
import { usePrefs } from "../../../lib/prefs";

const ACTIONS: Record<string, [string, string]> = {
  "auth.login": ["Signed in", "سجّل الدخول"],
  "auth.login_failed": ["Failed sign-in", "محاولة دخول فاشلة"],
  "auth.password_changed": ["Changed own password", "غيّر كلمة المرور"],
  "user.created": ["Created a user", "أنشأ مستخدماً"],
  "user.updated": ["Updated a user", "حدّث مستخدماً"],
  "user.password_reset": ["Reset a password", "أعاد تعيين كلمة مرور"],
  "complaint.submitted": ["Complaint submitted", "قُدّمت شكوى"],
  "complaint.updated": ["Updated a complaint", "حدّث شكوى"],
  "complaint.reclassify_requested": ["Re-ran complaint triage", "أعاد فرز شكوى"],
  "case.created": ["Created the case", "أنشأ القضية"],
  "case.created_from_complaint": ["Opened the case from a complaint", "فتح القضية من شكوى"],
  "case.updated": ["Updated case details", "حدّث تفاصيل القضية"],
  "case.priority_scored": ["Re-scored priority", "أعاد تقييم الأولوية"],
  "case.party_added": ["Added a party", "أضاف طرفاً"],
  "case.party_removed": ["Removed a party", "أزال طرفاً"],
  "case.timeline_added": ["Added a timeline event", "أضاف حدثاً"],
  "case.timeline_removed": ["Removed a timeline event", "أزال حدثاً"],
  "case.intelligence_extracted": ["Analysed a document", "حلّل مستنداً"],
  "case.sources_compared": ["Compared two sources", "قارن مصدرين"],
  "case.research_saved": ["Saved legal research", "حفظ بحثاً قانونياً"],
  "case.evidence_added": ["Added evidence", "أضاف دليلاً"],
  "case.ruling_entered": ["Entered the ruling", "أدخل الحكم"],
  "hearing.scheduled": ["Scheduled a hearing", "جدول جلسة"],
  "hearing.updated": ["Updated a hearing", "حدّث جلسة"],
  "courtroom.session_opened": ["Opened a courtroom session", "فتح جلسة المنصة"],
  "courtroom.called_to_stand": ["Called someone to the stand", "استدعى شخصاً إلى المنصة"],
  "courtroom.stepped_down": ["Closed a statement", "أغلق إفادة"],
  "courtroom.recording_uploaded": ["Uploaded a recording", "رفع تسجيلاً"],
  "courtroom.recording_viewed": ["Played a recording", "شغّل تسجيلاً"],
  "courtroom.transcript_edited": ["Corrected a transcript", "صحّح تفريغاً"],
  "courtroom.session_closed": ["Closed the courtroom session", "أغلق جلسة المنصة"],
  "evidence.uploaded": ["Uploaded evidence", "رفع دليلاً"],
  "evidence.downloaded": ["Opened/downloaded evidence", "فتح/نزّل دليلاً"],
  "evidence.text_viewed": ["Viewed evidence text", "اطّلع على نص دليل"],
  "evidence.integrity_checked": ["Verified evidence integrity", "تحقق من سلامة دليل"],
  "evidence.reviewed": ["Marked evidence reviewed", "وسم دليلاً كمُراجَع"],
  "evidence.flagged": ["Flagged evidence", "وضع ملاحظة على دليل"],
  "evidence.signature_checked": ["Checked a signature", "فحص توقيعاً"],
  "evidence.reprocess_requested": ["Re-processed evidence", "أعاد معالجة دليل"],
  "library.document_uploaded": ["Added a law", "أضاف قانوناً"],
  "library.document_deleted": ["Removed a law", "أزال قانوناً"],
  "library.document_reindex": ["Re-indexed a law", "أعاد فهرسة قانون"],
  "research.asked": ["Asked a research question", "طرح سؤالاً بحثياً"],
  "person.created": ["Registered a person", "سجّل شخصاً"],
  "person.updated": ["Updated a person", "حدّث بيانات شخص"],
};

export function describeAction(a: AuditEntry, t: (en: string, ar: string) => string): string {
  const pair = ACTIONS[a.action];
  const base = pair ? t(pair[0], pair[1]) : a.action;
  const d = a.detail ?? {};
  const extra = (d as any).person ?? (d as any).label ?? (d as any).title ?? (d as any).case_number ?? (d as any).reference ?? (d as any).username;
  return extra ? `${base}: ${extra}` : base;
}

export default function Audit() {
  const { t, lang } = usePrefs();
  const [username, setUsername] = useState("");
  const [du, setDu] = useState("");
  const [action, setAction] = useState("");
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => { setDu(username); setOffset(0); }, 300);
    return () => clearTimeout(id);
  }, [username]);
  const audit = useAudit({ username: du || undefined, action: action || undefined, offset });

  const columns: Column<AuditEntry>[] = [
    { key: "at", header: t("When", "الوقت"), cell: (a) => <span className="whitespace-nowrap text-sm">{fmtDateTime(a.at, lang)}</span> },
    { key: "who", header: t("Who", "من"), cell: (a) => (
      <div>
        <div className="text-sm font-medium">{a.username ?? t("Public", "العموم")}</div>
        {a.role && <div className="text-xs muted">{label.systemRole(a.role, lang)}</div>}
      </div>
    ) },
    { key: "what", header: t("What", "ماذا"), cell: (a) => (
      <div className="text-sm">
        {describeAction(a, t)}
        {a.action === "auth.login_failed" && <Badge tone="warning" className="ms-2">{t("security", "أمني")}</Badge>}
      </div>
    ) },
    { key: "entity", header: t("Record", "السجل"), hideOnMobile: true, cell: (a) => (
      a.entity_type === "case" && a.entity_id ? <Link to={`/app/cases/${a.entity_id}?tab=activity`} className="text-sm text-primary-700 hover:underline">{t("Open case", "فتح القضية")}</Link>
        : <span className="text-xs muted">{a.entity_type ?? "—"}</span>
    ) },
    { key: "ip", header: "IP", hideOnMobile: true, cell: (a) => <span className="font-mono text-xs muted">{a.ip ?? "—"}</span> },
  ];

  return (
    <div>
      <PageHeader title={t("Audit log", "سجل التدقيق")} subtitle={t("Every sign-in, change and evidence access, newest first.", "كل دخول وتغيير واطلاع على الأدلة، الأحدث أولاً.")} />
      <div className="surface mb-4 grid gap-3 p-4 sm:grid-cols-2">
        <Input aria-label={t("User", "المستخدم")} placeholder={t("Filter by username", "تصفية حسب اسم المستخدم")} prefix={<Search className="size-4" />} value={username} onChange={(e) => setUsername(e.target.value)} dir="ltr" />
        <Select aria-label={t("Action", "الإجراء")} value={action} onChange={(e) => { setAction(e.target.value); setOffset(0); }} placeholder={t("All actions", "كل الإجراءات")}
          options={[
            { value: "auth", label: t("Sign-ins", "الدخول") }, { value: "case", label: t("Cases", "القضايا") }, { value: "evidence", label: t("Evidence", "الأدلة") },
            { value: "courtroom", label: t("Courtroom", "المنصة") }, { value: "hearing", label: t("Hearings", "الجلسات") }, { value: "complaint", label: t("Complaints", "الشكاوى") },
            { value: "library", label: t("Law library", "المكتبة") }, { value: "user", label: t("User management", "إدارة المستخدمين") }, { value: "research", label: t("Research", "البحث") },
          ]} />
      </div>
      <div className="surface overflow-hidden">
        {audit.isError ? <div className="p-5"><ErrorState error={audit.error} onRetry={() => audit.refetch()} /></div> : (
          <>
            <DataTable columns={columns} rows={audit.data?.items} rowKey={(a) => String(a.id)} loading={audit.isLoading}
              empty={<EmptyState icon={<ScrollText className="size-7" />} title={t("No entries", "لا سجلات")} />} />
            {audit.data && <Pagination total={audit.data.total} pageSize={50} offset={offset} onChange={setOffset} />}
          </>
        )}
      </div>
    </div>
  );
}
