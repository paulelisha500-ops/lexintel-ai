import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlarmClock, CalendarDays, FileWarning, FolderOpen, Inbox, Mic, Plus } from "lucide-react";
import { useAnalytics, useCases, useHearings } from "../../api/hooks";
import { useAuth } from "../../auth/AuthContext";
import { BarList, ChartFrame, ColumnChart } from "../../components/charts";
import { Alert, Badge, Card, EmptyState, ErrorState, Skeleton, StatTile } from "../../components/ui/core";
import { PageHeader } from "../../components/ui/data";
import { courtDay, fmtDate, fmtNumber, fmtTime, greeting } from "../../lib/format";
import { label } from "../../lib/labels";
import { usePrefs } from "../../lib/prefs";
import { can } from "../../lib/roles";
import { PriorityBadge, StatusBadge } from "./shared";

export default function Dashboard() {
  const { t, lang } = usePrefs();
  const { user } = useAuth();
  const navigate = useNavigate();
  const today = courtDay();
  const analytics = useAnalytics();
  const hearings = useHearings({ day: today });
  const queue = useCases({ open_only: true, limit: 6 });
  const a = analytics.data;

  const firstName = (user?.fullName ?? "").replace(/^(Judge|القاضي)\s+/i, "").split(" ")[0];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={fmtDate(new Date(), lang)}
        title={`${greeting(lang)}${firstName ? `, ${firstName}` : ""}`}
        subtitle={t("Here's what needs attention today.", "إليك ما يحتاج إلى متابعة اليوم.")}
        actions={
          can.createCase(user?.role) && (
            <Link to="/app/cases?new=1" className="aegov-btn btn-sm">
              <Plus className="size-4" aria-hidden /> {t("New case", "قضية جديدة")}
            </Link>
          )
        }
      />

      {analytics.isError && <ErrorState error={analytics.error} onRetry={() => analytics.refetch()} />}
      {a && a.unavailable.length > 0 && (
        <Alert tone="warning" size="sm">
          {t("Some figures are temporarily unavailable: ", "بعض الأرقام غير متاحة مؤقتاً: ")}
          {a.unavailable.join(", ")}
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {!a ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            <StatTile icon={<CalendarDays className="size-5" />} label={t("Hearings today", "جلسات اليوم")} value={fmtNumber(a.hearings.today, lang)}
              hint={t(`${a.hearings.next_7_days} in the next 7 days`, `${a.hearings.next_7_days} خلال 7 أيام`)} onClick={() => navigate("/app/hearings")} />
            <StatTile icon={<FolderOpen className="size-5" />} tone="blue" label={t("Open cases", "القضايا المفتوحة")} value={fmtNumber(a.cases.open, lang)}
              hint={t(`${a.cases.open_by_priority.high ?? 0} high priority`, `${a.cases.open_by_priority.high ?? 0} ذات أولوية عالية`)} onClick={() => navigate("/app/cases?open_only=1")} />
            {can.triageComplaints(user?.role) ? (
              <StatTile icon={<Inbox className="size-5" />} tone="green" label={t("Complaints awaiting triage", "شكاوى بانتظار الفرز")} value={fmtNumber(a.complaints.awaiting_triage, lang)}
                hint={t(`${a.complaints.total} total`, `${a.complaints.total} إجمالاً`)} onClick={() => navigate("/app/complaints")} />
            ) : (
              <StatTile icon={<AlarmClock className="size-5" />} tone="red" label={t("Deadlines in 14 days", "مهل خلال 14 يوماً")} value={fmtNumber(a.cases.deadlines_next_14_days, lang)}
                hint={t(`${a.cases.overdue_deadlines} overdue`, `${a.cases.overdue_deadlines} متأخرة`)} onClick={() => navigate("/app/cases?open_only=1")} />
            )}
            <StatTile icon={<FileWarning className="size-5" />} tone="red" label={t("Evidence pending review", "أدلة بانتظار المراجعة")} value={fmtNumber(a.evidence.pending_review, lang)}
              hint={a.evidence.processing ? t(`${a.evidence.processing} still processing`, `${a.evidence.processing} قيد المعالجة`) : t("All processed", "تمت معالجتها كلها")} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Card
          className="xl:col-span-3"
          title={t("Today's hearings", "جلسات اليوم")}
          actions={<Link to="/app/hearings" className="text-sm font-medium text-primary-700 hover:underline">{t("Calendar", "التقويم")}</Link>}
          padded={false}
        >
          {hearings.isLoading ? (
            <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : hearings.isError ? (
            <div className="p-5"><ErrorState error={hearings.error} onRetry={() => hearings.refetch()} /></div>
          ) : !hearings.data?.length ? (
            <EmptyState icon={<CalendarDays className="size-7" />} title={t("No hearings today", "لا جلسات اليوم")} className="py-10" />
          ) : (
            <ul className="divide-y divide-aeblack-50">
              {hearings.data.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
                  <div className="w-14 text-center">
                    <div className="font-heading text-lg font-bold tabular-nums" dir="ltr">{fmtTime(h.scheduled_at, lang)}</div>
                    <div className="text-[11px] muted">{h.duration_minutes}{t("m", "د")}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link to={`/app/cases/${h.case_id}`} className="block truncate font-medium hover:text-primary-700 hover:underline">
                      {h.case_title}
                    </Link>
                    <div className="text-xs muted">
                      <span dir="ltr">{h.case_number}</span> · {h.courtroom ?? t("No courtroom", "بدون قاعة")} · {h.judge_name ?? t("No judge assigned", "لم يُعيَّن قاضٍ")}
                    </div>
                  </div>
                  <Badge tone={h.status === "in_progress" ? "warning" : h.status === "completed" ? "success" : h.status === "cancelled" ? "error" : "info"}>
                    {label.hearingStatus(h.status, lang)}
                  </Badge>
                  {can.runStand(user?.role) && ["scheduled", "in_progress"].includes(h.status) && (
                    <Link to={`/app/courtroom/${h.id}`} className="aegov-btn btn-soft btn-xs">
                      <Mic className="size-3.5" aria-hidden /> {t("Stand", "المنصة")}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          className="xl:col-span-2"
          title={t("Priority queue", "قائمة الأولويات")}
          subtitle={t("Workload recommendation — never about merits", "توصية لتنظيم العمل — لا تتعلق بموضوع القضية")}
          actions={<Link to="/app/cases?open_only=1" className="text-sm font-medium text-primary-700 hover:underline">{t("All cases", "كل القضايا")}</Link>}
          padded={false}
        >
          {queue.isLoading ? (
            <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : !queue.data?.items.length ? (
            <EmptyState title={t("No open cases", "لا قضايا مفتوحة")} className="py-10" />
          ) : (
            <ul className="divide-y divide-aeblack-50">
              {queue.data.items.map((c) => (
                <li key={c.id}>
                  <Link to={`/app/cases/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-primary-50/60">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{c.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs muted">
                        <span dir="ltr">{c.case_number}</span>
                        <StatusBadge status={c.status} />
                      </div>
                    </div>
                    <PriorityBadge priority={c.priority} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {a && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ChartFrame
            title={t("Cases opened per week", "القضايا المفتوحة أسبوعياً")}
            subtitle={t("Last 12 weeks", "آخر 12 أسبوعاً")}
            empty={!a.cases.opened_per_week.some((w) => w.cases_opened)}
            table={{
              head: [t("Week of", "أسبوع"), t("Cases", "القضايا")],
              rows: a.cases.opened_per_week.map((w) => [fmtDate(w.week_start, lang), w.cases_opened]),
            }}
          >
            <ColumnChart
              valueLabel={t("Cases", "القضايا")}
              data={a.cases.opened_per_week.map((w) => ({ label: fmtDate(w.week_start, lang).replace(/\s\d{4}$/, ""), value: w.cases_opened }))}
            />
          </ChartFrame>
          <ChartFrame
            title={t("Open cases by priority", "القضايا المفتوحة حسب الأولوية")}
            empty={!a.cases.open}
            table={{
              head: [t("Priority", "الأولوية"), t("Cases", "القضايا")],
              rows: ["high", "medium", "low", "unscored"].map((p) => [label.priority(p, lang), a.cases.open_by_priority[p] ?? 0]),
            }}
          >
            <BarList
              ramp
              onSelect={(k) => navigate(`/app/cases?open_only=1&priority=${k}`)}
              items={[
                { key: "high", label: label.priority("high", lang), value: a.cases.open_by_priority.high ?? 0, colorIndex: 2 },
                { key: "medium", label: label.priority("medium", lang), value: a.cases.open_by_priority.medium ?? 0, colorIndex: 1 },
                { key: "low", label: label.priority("low", lang), value: a.cases.open_by_priority.low ?? 0, colorIndex: 0 },
                { key: "unscored", label: label.priority("unscored", lang), value: a.cases.open_by_priority.unscored ?? 0, colorIndex: 0 },
              ]}
            />
          </ChartFrame>
        </div>
      )}
    </div>
  );
}
