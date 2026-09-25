import { addDays, format, formatDistanceToNowStrict, parseISO } from "date-fns";
import { arSA, enGB } from "date-fns/locale";
import type { Lang } from "./prefs";

/**
 * Court time.
 *
 * Hearings are held in the UAE and their times belong to the court, not to
 * the machine someone happens to be reading the screen on: a clerk on a
 * laptop still set to another country must not see a 10:00 hearing as 11:30.
 * Instants are stored in UTC and every date shown to a person is rendered in
 * `COURT_TZ`, and every date typed by a person is read as court time.
 */
export const COURT_TZ = "Asia/Dubai";

const courtFields = new Intl.DateTimeFormat("en-US", {
  timeZone: COURT_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

/**
 * The same instant, with its fields rewritten to the court's wall clock.
 * date-fns formats a Date through the browser's own zone, so handing it this
 * shifted value is what makes it print court time.
 */
function inCourtZone(d: Date): Date {
  const p: Record<string, string> = {};
  for (const part of courtFields.formatToParts(d)) p[part.type] = part.value;
  // "24" appears at midnight in the hour-cycle Intl uses here.
  return new Date(Number(p.year), Number(p.month) - 1, Number(p.day),
                  Number(p.hour) % 24, Number(p.minute), Number(p.second));
}

/** Now, as the court's wall clock reads it. */
export function courtNow(): Date {
  return inCourtZone(new Date());
}

/** Today in the court's zone as "YYYY-MM-DD", for `?day=` queries. */
export function courtDay(value: string | Date = new Date()): string {
  if (typeof value === "string" && DATE_ONLY.test(value)) return value;
  const c = toDisplay(value) ?? inCourtZone(new Date());
  return calendarDay(c);
}

/**
 * "YYYY-MM-DD" from a Date's own fields, with no shift. Calendar grids build
 * their days from `courtNow()`, so those Dates already carry court fields and
 * must not be converted a second time.
 */
export function calendarDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The real instant of a court wall-clock Date (a grid day, a typed time). */
export function courtWallClockToIso(d: Date): string {
  const asIfUtc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(),
                           d.getHours(), d.getMinutes(), d.getSeconds());
  // How far ahead of UTC the court's clock runs at that moment (+4h; the UAE
  // keeps no daylight saving, but this asks rather than assumes).
  const offsetMs = inCourtZone(new Date(asIfUtc)).getTime() - asIfUtc;
  return new Date(asIfUtc - offsetMs).toISOString();
}

/** True when two instants fall on the same day in the court's zone. */
export function sameCourtDay(a: Date | string, b: Date | string): boolean {
  return courtDay(a) === courtDay(b);
}

/** "2026-09-22" -- a calendar date, with no time and no zone. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The Date to format.
 *
 * An instant (a hearing, an upload, a statement) is converted to the court's
 * clock. A date with no time -- a statutory deadline, the day a law came into
 * force -- is already a calendar date: it has no instant to convert, and
 * shifting it by four hours would move it to the day before or after.
 */
function toDisplay(value: string | Date | null | undefined): Date | null {
  const d = toDate(value);
  if (!d) return null;
  return typeof value === "string" && DATE_ONLY.test(value) ? d : inCourtZone(d);
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  // Backend datetimes without a zone are UTC.
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value);
  const d = value.length > 10 && !hasZone ? parseISO(value + "Z") : parseISO(value);
  return isNaN(d.getTime()) ? null : d;
}

const locale = (lang: Lang) => (lang === "ar" ? arSA : enGB);

/**
 * Arabic gets the full month and weekday names. Arabic doesn't shorten them
 * the way English does, and date-fns abbreviates by cutting the word and
 * adding a kashida ("سبتـ", "ثلا"), which reads as a broken word rather than
 * as an abbreviation. The full forms are short enough to sit in the same
 * places in the layout.
 */
export const monthPattern = (lang: Lang) => (lang === "ar" ? "MMMM" : "MMM");
export const weekdayPattern = (lang: Lang) => (lang === "ar" ? "EEEE" : "EEE");

export function fmtDate(value: string | Date | null | undefined, lang: Lang): string {
  const d = toDisplay(value);
  return d ? format(d, `d ${monthPattern(lang)} yyyy`, { locale: locale(lang) }) : "—";
}

export function fmtDateTime(value: string | Date | null | undefined, lang: Lang): string {
  const d = toDisplay(value);
  return d ? format(d, `d ${monthPattern(lang)} yyyy, HH:mm`, { locale: locale(lang) }) : "—";
}

export function fmtTime(value: string | Date | null | undefined, lang: Lang): string {
  const d = toDisplay(value);
  return d ? format(d, "HH:mm", { locale: locale(lang) }) : "—";
}

export function fmtRelativeDay(value: string | Date | null | undefined, lang: Lang): string {
  const instant = toDate(value);
  if (!instant) return "—";
  // "Today" has to mean today in the courthouse, not on this laptop.
  const d = toDisplay(value)!;
  const day = courtDay(typeof value === "string" ? value : instant);
  const now = new Date();
  if (day === courtDay(now)) return lang === "ar" ? "اليوم" : "Today";
  if (day === courtDay(addDays(now, 1))) return lang === "ar" ? "غداً" : "Tomorrow";
  if (day === courtDay(addDays(now, -1))) return lang === "ar" ? "أمس" : "Yesterday";
  return format(d, `${weekdayPattern(lang)} d ${monthPattern(lang)}`, { locale: locale(lang) });
}

export function fmtAgo(value: string | Date | null | undefined, lang: Lang): string {
  const d = toDate(value);
  return d ? formatDistanceToNowStrict(d, { addSuffix: true, locale: locale(lang) }) : "—";
}

export function fmtNumber(value: number | null | undefined, lang: Lang, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(lang === "ar" ? "ar-AE" : "en-AE", { maximumFractionDigits: digits }).format(value);
}

export function fmtBytes(bytes: number | null | undefined): string {
  if (!bytes && bytes !== 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Fill a datetime-local input with the court's wall clock. */
export function toLocalInput(value: string | Date | null | undefined): string {
  const instant = toDate(value);
  if (!instant) return "";
  const d = inCourtZone(instant);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Read what was typed into a datetime-local input as court time, not as the
 *  reader's own time, and return the instant to store. */
export function localInputToIso(value: string): string {
  const typed = new Date(value);
  return isNaN(typed.getTime()) ? new Date(value).toISOString() : courtWallClockToIso(typed);
}

export function greeting(lang: Lang): string {
  const h = courtNow().getHours();
  if (lang === "ar") return h < 12 ? "صباح الخير" : "مساء الخير";
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
