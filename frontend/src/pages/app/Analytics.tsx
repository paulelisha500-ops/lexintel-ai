import React from "react";
import { useNavigate } from "react-router-dom";
import { Clock, FileWarning, Gavel, Inbox, Mic } from "lucide-react";
import { useAnalytics } from "../../api/hooks";
import { BarList, ChartFrame, ColumnChart, TrendChart } from "../../components/charts";
import { Alert, ErrorState, Skeleton, StatTile } from "../../components/ui/core";
import { PageHeader } from "../../components/ui/data";
import { fmtDate, fmtDateTime, fmtNumber } from "../../lib/format";
import { CASE_STATUSES, CASE_TYPES, COMPLAINT_STATUSES, label } from "../../lib/labels";
import { usePrefs } from "../../lib/prefs";

export default function Analytics() {
  const { t, lang } = usePrefs();
  const navigate = useNavigate();
  const q = useAnalytics();
  if (q.isLoading) return <div className="grid gap-4 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-64" />)}</div>;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const a = q.data;

  const orderedEntries = (dict: Record<string, [string, string]>, counts: Record<string, number>) =>
    Object.keys(dict).map((k) => ({ key: k, label: lang === "ar" ? dict[k][1] : dict[k][0], value: counts[k] ?? 0 }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Analytics", "التحليلات")}
        subtitle={t("Workload and throughput across the court. Figures refresh every minute.", "عبء العمل ومعدلات الإنجاز في المحكمة، وتُحدَّث الأرقام كل دقيقة.")}
        meta={<span className="text-xs muted">{t("Generated", "أُنشئت")} {fmtDateTime(a.generated_at, lang)}</span>}
      />
      {a.unavailable.length > 0 && <Alert tone="warning" size="sm">{t("Partial data — unavailable: ", "بيانات جزئية — غير متاح: ")}{a.unavailable.join(", ")}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile icon={<Gavel className="size-5" />} label={t("Rulings entered", "الأحكام الصادرة")} value={fmtNumber(a.rulings.total, lang)}
          hint={a.rulings.avg_days_to_ruling != null ? t(`Average ${a.rulings.avg_days_to_ruling} days from opening`, `بمتوسط ${a.rulings.avg_days_to_ruling} يوماً من الفتح`) : t("No rulings yet", "لا أحكام بعد")} />
        <StatTile icon={<Clock className="size-5" />} tone="red" label={t("Overdue deadlines", "مهل متجاوزة")} value={fmtNumber(a.cases.overdue_deadlines, lang)}
          hint={t(`${a.cases.deadlines_next_14_days} due within 14 days`, `${a.cases.deadlines_next_14_days} تستحق خلال 14 يوماً`)} onClick={() => navigate("/app/cases?open_only=1")} />
        <StatTile icon={<Inbox className="size-5" />} tone="green" label={t("Complaints (total)", "الشكاوى (الإجمالي)")} value={fmtNumber(a.complaints.total, lang)}
          hint={t(`${a.complaints.awaiting_triage} awaiting triage`, `${a.complaints.awaiting_triage} بانتظار الفرز`)} />
        <StatTile icon={<Mic className="size-5" />} tone="blue" label={t("Statements recorded", "الإفادات المسجلة")} value={a.statements.total != null ? fmtNumber(a.statements.total, lang) : "—"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartFrame title={t("Cases opened per week", "القضايا المفتوحة أسبوعياً")} subtitle={t("Last 12 weeks", "آخر 12 أسبوعاً")}
          empty={!a.cases.opened_per_week.some((w) => w.cases_opened)}
          table={{ head: [t("Week of", "أسبوع"), t("Cases", "القضايا")], rows: a.cases.opened_per_week.map((w) => [fmtDate(w.week_start, lang), w.cases_opened]) }}>
          <ColumnChart valueLabel={t("Cases", "القضايا")} data={a.cases.opened_per_week.map((w) => ({ label: fmtDate(w.week_start, lang).replace(/\s\d{4}$/, ""), value: w.cases_opened }))} />
        </ChartFrame>
        <ChartFrame title={t("Complaints received per day", "الشكاوى المستلمة يومياً")} subtitle={t("Last 30 days", "آخر 30 يوماً")}
          empty={!a.complaints.per_day_30.some((d) => d.complaints)}
          table={{ head: [t("Date", "التاريخ"), t("Complaints", "الشكاوى")], rows: a.complaints.per_day_30.map((d) => [fmtDate(d.date, lang), d.complaints]) }}>
          <TrendChart valueLabel={t("Complaints", "الشكاوى")} data={a.complaints.per_day_30.map((d) => ({ label: fmtDate(d.date, lang).replace(/\s\d{4}$/, ""), value: d.complaints }))} />
        </ChartFrame>
        <ChartFrame title={t("Cases by status", "القضايا حسب الحالة")} empty={!a.cases.total}
          table={{ head: [t("Status", "الحالة"), t("Cases", "القضايا")], rows: orderedEntries(CASE_STATUSES, a.cases.by_status).map((e) => [e.label, e.value]) }}>
          <BarList items={orderedEntries(CASE_STATUSES, a.cases.by_status)} onSelect={(k) => navigate(`/app/cases?status=${k}`)} />
        </ChartFrame>
        <ChartFrame title={t("Cases by type", "القضايا حسب النوع")} empty={!a.cases.total}
          table={{ head: [t("Type", "النوع"), t("Cases", "القضايا")], rows: orderedEntries(CASE_TYPES, a.cases.by_type).map((e) => [e.label, e.value]) }}>
          <BarList items={orderedEntries(CASE_TYPES, a.cases.by_type)} onSelect={(k) => navigate(`/app/cases?case_type=${k}`)} />
        </ChartFrame>
        <ChartFrame title={t("Complaints by status", "الشكاوى حسب الحالة")} empty={!a.complaints.total}
          table={{ head: [t("Status", "الحالة"), t("Complaints", "الشكاوى")], rows: orderedEntries(COMPLAINT_STATUSES, a.complaints.by_status).map((e) => [e.label, e.value]) }}>
          <BarList items={orderedEntries(COMPLAINT_STATUSES, a.complaints.by_status)} />
        </ChartFrame>
        <ChartFrame title={t("Evidence review", "مراجعة الأدلة")} empty={!a.evidence.total}
          table={{ head: [t("State", "الحالة"), t("Files", "الملفات")], rows: [
            [t("Pending review", "بانتظار المراجعة"), a.evidence.pending_review], [t("Flagged", "عليه ملاحظة"), a.evidence.flagged],
            [t("Processing", "قيد المعالجة"), a.evidence.processing], [t("Failed", "فشلت"), a.evidence.failed]] }}>
          <BarList items={[
            { key: "pending", label: t("Pending review", "بانتظار المراجعة"), value: a.evidence.pending_review },
            { key: "flagged", label: t("Flagged", "عليه ملاحظة"), value: a.evidence.flagged },
            { key: "processing", label: t("Processing", "قيد المعالجة"), value: a.evidence.processing },
            { key: "failed", label: t("Failed processing", "فشلت المعالجة"), value: a.evidence.failed },
          ]} />
          <p className="mt-4 flex items-center gap-1.5 text-xs muted"><FileWarning className="size-3.5" /> {t(`${a.evidence.total} evidence files in total`, `${a.evidence.total} ملف أدلة إجمالاً`)}</p>
        </ChartFrame>
      </div>
      <p className="text-xs muted">
        {t("Complaint categories use the AI triage suggestion where available: ", "تُستخدم تصنيفات الفرز الآلي للشكاوى حيثما توفرت: ")}
        {Object.entries(a.complaints.by_category).map(([k, v]) => `${label.caseType(k, lang)} ${v}`).join(" · ") || "—"}
      </p>
    </div>
  );
}
