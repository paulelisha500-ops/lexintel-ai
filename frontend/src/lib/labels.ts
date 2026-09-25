import type { Lang } from "./prefs";

type Pair = [en: string, ar: string];
type Dict = Record<string, Pair>;

function pick(dict: Dict, key: string | null | undefined, lang: Lang): string {
  if (!key) return "—";
  const pair = dict[key];
  if (!pair) return key.replace(/_/g, " ");
  return lang === "ar" ? pair[1] : pair[0];
}

export const CASE_TYPES: Dict = {
  criminal: ["Criminal", "جنائية"],
  civil: ["Civil", "مدنية"],
  cybercrime: ["Cybercrime", "جرائم إلكترونية"],
  traffic: ["Traffic", "مرورية"],
  grievance: ["Public grievance", "تظلم عام"],
};

export const CASE_STATUSES: Dict = {
  intake: ["Intake", "قيد الاستلام"],
  under_investigation: ["Under investigation", "قيد التحقيق"],
  ready_for_hearing: ["Ready for hearing", "جاهزة للجلسة"],
  in_hearing: ["In hearing", "في الجلسات"],
  awaiting_ruling: ["Awaiting ruling", "بانتظار الحكم"],
  resolved: ["Resolved", "تم الفصل"],
  closed: ["Closed", "مغلقة"],
};

export const PRIORITY: Dict = {
  high: ["High", "عالية"],
  medium: ["Medium", "متوسطة"],
  low: ["Low", "منخفضة"],
  unscored: ["Not scored", "غير مقيّمة"],
};

export const HEARING_ROLES: Dict = {
  defendant: ["Defendant", "مدعى عليه"],
  plaintiff: ["Plaintiff", "مدعٍ"],
  witness: ["Witness", "شاهد"],
  expert_witness: ["Expert witness", "خبير"],
  prosecutor: ["Prosecutor", "ممثل النيابة"],
  defense_counsel: ["Defense counsel", "محامي الدفاع"],
  interpreter: ["Interpreter", "مترجم"],
  victim: ["Victim", "مجني عليه"],
};

export const HEARING_STATUSES: Dict = {
  scheduled: ["Scheduled", "مجدولة"],
  in_progress: ["In progress", "منعقدة الآن"],
  completed: ["Completed", "منتهية"],
  cancelled: ["Cancelled", "ملغاة"],
  adjourned: ["Adjourned", "مؤجلة"],
};

export const COMPLAINT_STATUSES: Dict = {
  received: ["Received", "مستلمة"],
  under_review: ["Under review", "قيد المراجعة"],
  case_opened: ["Case opened", "فُتحت قضية"],
  resolved: ["Resolved", "تمت المعالجة"],
  rejected: ["Closed without action", "أُغلقت دون إجراء"],
  duplicate: ["Duplicate", "مكررة"],
};

export const SYSTEM_ROLES: Dict = {
  judge: ["Judge", "قاضٍ"],
  prosecutor: ["Prosecutor", "وكيل نيابة"],
  clerk: ["Court clerk", "كاتب المحكمة"],
  case_officer: ["Case officer", "مسؤول القضايا"],
  admin: ["Administrator", "مسؤول النظام"],
};

export const EVIDENCE_TYPES: Dict = {
  document: ["Document", "مستند"],
  image: ["Image", "صورة"],
  video: ["Video", "فيديو"],
  audio: ["Audio", "تسجيل صوتي"],
  cctv: ["CCTV", "كاميرات مراقبة"],
  digital: ["Digital", "دليل رقمي"],
  contract: ["Contract", "عقد"],
};

export const PROCESSING: Dict = {
  queued: ["Queued", "في الانتظار"],
  processing: ["Processing", "قيد المعالجة"],
  done: ["Processed", "تمت المعالجة"],
  failed: ["Failed", "فشلت"],
  skipped: ["Stored only", "محفوظ فقط"],
  pending_review: ["Pending review", "بانتظار المراجعة"],
  reviewed: ["Reviewed", "تمت المراجعة"],
  flagged: ["Flagged", "عليه ملاحظة"],
  indexed: ["Indexed", "مفهرس"],
};

export const JURISDICTIONS: Dict = {
  federal: ["Federal", "اتحادي"],
  difc: ["DIFC", "مركز دبي المالي العالمي"],
  adgm: ["ADGM", "سوق أبوظبي العالمي"],
  dubai: ["Dubai", "دبي"],
  abu_dhabi: ["Abu Dhabi", "أبوظبي"],
  sharjah: ["Sharjah", "الشارقة"],
  other_emirate: ["Other emirate", "إمارة أخرى"],
};

export const label = {
  caseType: (k: string | null | undefined, l: Lang) => pick(CASE_TYPES, k, l),
  caseStatus: (k: string | null | undefined, l: Lang) => pick(CASE_STATUSES, k, l),
  priority: (k: string | null | undefined, l: Lang) => pick(PRIORITY, k, l),
  hearingRole: (k: string | null | undefined, l: Lang) => pick(HEARING_ROLES, k, l),
  hearingStatus: (k: string | null | undefined, l: Lang) => pick(HEARING_STATUSES, k, l),
  complaintStatus: (k: string | null | undefined, l: Lang) => pick(COMPLAINT_STATUSES, k, l),
  systemRole: (k: string | null | undefined, l: Lang) => pick(SYSTEM_ROLES, k, l),
  evidenceType: (k: string | null | undefined, l: Lang) => pick(EVIDENCE_TYPES, k, l),
  processing: (k: string | null | undefined, l: Lang) => pick(PROCESSING, k, l),
  jurisdiction: (k: string | null | undefined, l: Lang) => pick(JURISDICTIONS, k, l),
};

export function options(dict: Dict, lang: Lang): { value: string; label: string }[] {
  return Object.entries(dict).map(([value, pair]) => ({ value, label: lang === "ar" ? pair[1] : pair[0] }));
}
