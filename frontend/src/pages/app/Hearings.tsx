import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { addDays, format, startOfWeek } from "date-fns";
import { arSA, enGB } from "date-fns/locale";
import { CalendarPlus, ChevronLeft, ChevronRight, Mic, Pencil } from "lucide-react";
import { useHearings } from "../../api/hooks";
import type { Hearing } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { HearingFormModal } from "../../components/HearingForm";
import { Badge, Button, Checkbox, EmptyState, ErrorState, Skeleton } from "../../components/ui/core";
import { PageHeader } from "../../components/ui/data";
import { Segmented } from "../../components/ui/overlay";
import { cn } from "../../lib/cn";
import { calendarDay, courtDay, courtNow, courtWallClockToIso, fmtTime, monthPattern, weekdayPattern } from "../../lib/format";
import { label } from "../../lib/labels";
import { usePrefs } from "../../lib/prefs";
import { can } from "../../lib/roles";

const STATUS_TONE: Record<string, "info" | "warning" | "success" | "error" | "neutral"> = {
  scheduled: "info", in_progress: "warning", completed: "success", cancelled: "error", adjourned: "neutral",
};

export default function Hearings() {
  const { t, lang, dir } = usePrefs();
  const { user } = useAuth();
  const [view, setView] = useState("week");
  const [anchor, setAnchor] = useState(() => courtNow());
  const [mine, setMine] = useState(false);
  const [form, setForm] = useState<{ open: boolean; hearing: Hearing | null; start: Date | null }>({ open: false, hearing: null, start: null });
  const locale = lang === "ar" ? arSA : enGB;

  const range = useMemo(() => {
    if (view === "day") {
      const start = new Date(anchor);
      start.setHours(0, 0, 0, 0);
      return { start, end: addDays(start, 1), days: [start] };
    }
    const start = startOfWeek(anchor, { weekStartsOn: 1 });
    return { start, end: addDays(start, 7), days: Array.from({ length: 7 }, (_, i) => addDays(start, i)) };
  }, [anchor, view]);

  // The grid spans court days, so ask the server for the instants those days start and end at.
  const hearings = useHearings({ start: courtWallClockToIso(range.start), end: courtWallClockToIso(range.end), mine: mine || undefined });
  const step = view === "day" ? 1 : 7;
  const Prev = dir === "rtl" ? ChevronRight : ChevronLeft;
  const Next = dir === "rtl" ? ChevronLeft : ChevronRight;

  // The grid days are court days, so match each hearing on its court day too.
  const byDay = (d: Date) => (hearings.data ?? []).filter((h) => courtDay(h.scheduled_at) === calendarDay(d));

  return (
    <div>
      <PageHeader
        title={t("Hearings", "الجلسات")}
        subtitle={t("Courtroom and judge double-bookings are blocked when scheduling.", "يُمنع تعارض القاعات ومواعيد القضاة عند الجدولة.")}
        actions={can.schedule(user?.role) && (
          <Button icon={<CalendarPlus className="size-4" />} onClick={() => setForm({ open: true, hearing: null, start: null })}>{t("Schedule hearing", "جدولة جلسة")}</Button>
        )}
      />

      <div className="surface mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="xs" iconOnly aria-label={t("Previous", "السابق")} onClick={() => setAnchor((a) => addDays(a, -step))}><Prev className="size-4" /></Button>
          <Button variant="outline" size="xs" onClick={() => setAnchor(courtNow())}>{t("Today", "اليوم")}</Button>
          <Button variant="outline" size="xs" iconOnly aria-label={t("Next", "التالي")} onClick={() => setAnchor((a) => addDays(a, step))}><Next className="size-4" /></Button>
        </div>
        <div className="font-heading font-semibold">
          {view === "day"
            ? format(range.start, "EEEE d MMMM yyyy", { locale })
            : `${format(range.start, `d ${monthPattern(lang)}`, { locale })} – ${format(addDays(range.end, -1), `d ${monthPattern(lang)} yyyy`, { locale })}`}
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-4">
          {user?.role === "judge" && <Checkbox label={t("Only my hearings", "جلساتي فقط")} checked={mine} onChange={(e) => setMine(e.target.checked)} />}
          <Segmented value={view} onChange={setView} options={[{ value: "day", label: t("Day", "يوم") }, { value: "week", label: t("Week", "أسبوع") }]} />
        </div>
      </div>

      {hearings.isError ? <ErrorState error={hearings.error} onRetry={() => hearings.refetch()} /> : hearings.isLoading ? <Skeleton className="h-96" /> : (
        <div className={cn("grid gap-3", view === "week" && "md:grid-cols-7")}>
          {range.days.map((d) => {
            const items = byDay(d);
            const today = calendarDay(d) === courtDay(new Date());
            return (
              <section key={d.toISOString()} className={cn("surface flex min-h-40 flex-col", today && "ring-2 ring-primary-500")}>
                <header className="flex items-center justify-between border-b border-aeblack-100 px-3 py-2">
                  <div>
                    <div className="text-xs uppercase muted">{format(d, weekdayPattern(lang), { locale })}</div>
                    <div className={cn("font-heading text-lg font-bold", today && "text-primary-700")}>{format(d, "d", { locale })}</div>
                  </div>
                  {can.schedule(user?.role) && (
                    <button className="rounded-lg p-1 muted hover:bg-aeblack-50 hover:text-primary-700"
                      aria-label={t("Schedule on this day", "جدولة في هذا اليوم")}
                      onClick={() => { const s = new Date(d); s.setHours(9, 30, 0, 0); setForm({ open: true, hearing: null, start: new Date(courtWallClockToIso(s)) }); }}>
                      <CalendarPlus className="size-4" />
                    </button>
                  )}
                </header>
                <div className="flex-1 space-y-2 p-2">
                  {items.length === 0 ? (
                    view === "day" ? <EmptyState title={t("No hearings", "لا جلسات")} className="py-10" /> : <div className="py-4 text-center text-xs muted">—</div>
                  ) : items.map((h) => (
                    <article key={h.id} className="rounded-lg border border-aeblack-100 bg-whitely-100 p-2.5 text-sm">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold tabular-nums" dir="ltr">{fmtTime(h.scheduled_at, lang)}–{fmtTime(h.ends_at ?? h.scheduled_at, lang)}</span>
                        <Badge tone={STATUS_TONE[h.status] ?? "neutral"} className="!text-[10px]">{label.hearingStatus(h.status, lang)}</Badge>
                      </div>
                      <Link to={`/app/cases/${h.case_id}?tab=hearings`} className="mt-1 block font-medium leading-snug hover:text-primary-700 hover:underline">{h.case_title}</Link>
                      <div className="mt-0.5 text-xs muted"><span dir="ltr">{h.case_number}</span></div>
                      <div className="text-xs muted">{[h.courtroom, h.judge_name].filter(Boolean).join(" · ")}</div>
                      <div className="mt-2 flex gap-1">
                        {can.runStand(user?.role) && ["scheduled", "in_progress"].includes(h.status) && (
                          <Link to={`/app/courtroom/${h.id}`} className="aegov-btn btn-soft btn-xs"><Mic className="size-3" /> {t("Stand", "المنصة")}</Link>
                        )}
                        {can.schedule(user?.role) && (
                          <button className="aegov-btn btn-link btn-xs" onClick={() => setForm({ open: true, hearing: h, start: null })}><Pencil className="size-3" /> {t("Edit", "تعديل")}</button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <HearingFormModal open={form.open} hearing={form.hearing} defaultStart={form.start} onClose={() => setForm({ open: false, hearing: null, start: null })} />
    </div>
  );
}
