import React from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Mic } from "lucide-react";
import { useHearings } from "../../../api/hooks";
import { Badge, Card, EmptyState, ErrorState, Skeleton } from "../../../components/ui/core";
import { PageHeader } from "../../../components/ui/data";
import { courtDay, fmtTime } from "../../../lib/format";
import { label } from "../../../lib/labels";
import { usePrefs } from "../../../lib/prefs";

export default function CourtroomSelect() {
  const { t, lang } = usePrefs();
  const today = courtDay();
  const hearings = useHearings({ day: today });
  const active = (hearings.data ?? []).filter((h) => ["scheduled", "in_progress"].includes(h.status));

  return (
    <div>
      <PageHeader
        title={t("Courtroom stand", "منصة الشهادة")}
        subtitle={t("Choose today's hearing to open or resume its session.", "اختر جلسة اليوم لفتح جلستها أو استئنافها.")}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title={t("Today's hearings", "جلسات اليوم")} padded={false}>
            {hearings.isLoading ? <div className="p-5"><Skeleton className="h-40" /></div> : hearings.isError ? <div className="p-5"><ErrorState error={hearings.error} onRetry={() => hearings.refetch()} /></div> : !active.length ? (
              <EmptyState icon={<CalendarDays className="size-7" />} title={t("No open hearings today", "لا جلسات مفتوحة اليوم")}
                action={<Link to="/app/hearings" className="aegov-btn btn-outline btn-sm">{t("Open the calendar", "فتح التقويم")}</Link>} />
            ) : (
              <ul className="divide-y divide-aeblack-50">
                {active.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                    <div className="w-16 font-heading text-xl font-bold tabular-nums" dir="ltr">{fmtTime(h.scheduled_at, lang)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{h.case_title}</div>
                      <div className="text-xs muted"><span dir="ltr">{h.case_number}</span> · {h.courtroom ?? "—"} · {h.judge_name ?? "—"}</div>
                    </div>
                    <Badge tone={h.status === "in_progress" ? "warning" : "info"}>{label.hearingStatus(h.status, lang)}</Badge>
                    <Link to={`/app/courtroom/${h.id}`} className="aegov-btn btn-sm">
                      <Mic className="size-4" /> {h.status === "in_progress" ? t("Resume", "استئناف") : t("Open session", "فتح الجلسة")}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="overflow-hidden rounded-xl">
          <img src="/images/microphone.jpg" alt="" className="aspect-[4/3] w-full object-cover" />
          <div className="surface rounded-t-none p-5 text-sm">
            <p className="font-semibold">{t("How the stand works", "كيف تعمل المنصة")}</p>
            <ol className="mt-2 list-decimal space-y-1 ps-5 muted">
              <li>{t("Call one person at a time and confirm their identity.", "استدعِ شخصاً واحداً في كل مرة وأكّد هويته.")}</li>
              <li>{t("Speech is transcribed live on this server.", "يُفرَّغ الكلام مباشرة على هذا الخادم.")}</li>
              <li>{t("Review and correct the transcript at step-down.", "راجع التفريغ وصحّحه عند الانصراف.")}</li>
              <li>{t("The recording uploads and is transcribed again at full quality.", "يُرفع التسجيل ويُفرَّغ مجدداً بجودة كاملة.")}</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
