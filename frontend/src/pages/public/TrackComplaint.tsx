import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Circle, Search } from "lucide-react";
import { api, ApiError } from "../../api/client";
import { Alert, Button, Input } from "../../components/ui/core";
import { cn } from "../../lib/cn";
import { fmtDateTime } from "../../lib/format";
import { label } from "../../lib/labels";
import { usePrefs } from "../../lib/prefs";

interface TrackResult {
  reference_number: string;
  status: string;
  case_type: string;
  submitted_at: string;
  updated_at: string | null;
  assigned_department: string | null;
  case_number: string | null;
}

const FLOW = ["received", "under_review", "case_opened"];

export default function TrackComplaint() {
  const { t, lang } = usePrefs();
  const [params] = useSearchParams();
  const [reference, setReference] = useState(params.get("reference") ?? "");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TrackResult | null>(null);

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reference.trim() || !code.trim()) {
      setError(t("Enter both the reference number and tracking code.", "أدخل الرقم المرجعي ورمز المتابعة معاً."));
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.post<TrackResult>(
        "/complaints/track",
        { reference: reference.trim().toUpperCase(), code: code.trim().toUpperCase() },
        { anonymous: true },
      ));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Lookup failed. Please try again.", "فشل البحث. حاول مرة أخرى."));
    } finally {
      setLoading(false);
    }
  };

  const stageIndex = result ? FLOW.indexOf(result.status) : -1;
  const closedOther = result && stageIndex === -1;

  return (
    <div>
      <section className="relative isolate overflow-hidden bg-night-950">
        <img src="/images/abu-dhabi-night.jpg" alt="" className="absolute inset-0 -z-10 size-full object-cover opacity-45" />
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
          <h1 className="font-heading text-3xl font-bold text-white sm:text-4xl">{t("Track a complaint", "متابعة شكوى")}</h1>
          <p className="mt-2 text-white/80">
            {t("Use the reference number and tracking code you received when you filed.", "استخدم الرقم المرجعي ورمز المتابعة اللذين حصلت عليهما عند التقديم.")}
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <form onSubmit={lookup} className="surface grid gap-5 p-6 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Input label={t("Reference number", "الرقم المرجعي")} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="CMP-2026-XXXXXX" dir="ltr" autoComplete="off" />
          <Input label={t("Tracking code", "رمز المتابعة")} value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXXXXXX" dir="ltr" autoComplete="off" />
          <Button type="submit" loading={loading} icon={<Search className="size-4" />} className="h-12">
            {t("Check status", "عرض الحالة")}
          </Button>
        </form>

        {error && <Alert tone="error" className="mt-6">{error}</Alert>}

        {result && (
          <div className="surface mt-6 p-6 animate-slide-up">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="font-mono text-lg font-bold" dir="ltr">{result.reference_number}</div>
              <div className="text-sm muted">
                {t("Filed", "تاريخ التقديم")}: {fmtDateTime(result.submitted_at, lang)}
              </div>
            </div>

            {closedOther ? (
              <Alert tone="info" className="mt-5" title={label.complaintStatus(result.status, lang)}>
                {t("This complaint has been closed. Contact the relevant department if you need more information.",
                  "أُغلقت هذه الشكوى. تواصل مع الجهة المعنية إذا احتجت إلى مزيد من المعلومات.")}
              </Alert>
            ) : (
              <ol className="mt-6 space-y-0">
                {FLOW.map((stage, i) => {
                  const done = i <= stageIndex;
                  return (
                    <li key={stage} className="relative flex gap-4 pb-6 last:pb-0">
                      {i < FLOW.length - 1 && (
                        <span className={cn("absolute start-[11px] top-7 h-[calc(100%-1.5rem)] w-0.5", i < stageIndex ? "bg-primary-600" : "bg-aeblack-100")} />
                      )}
                      {done ? <CheckCircle2 className="size-6 shrink-0 text-primary-600" /> : <Circle className="size-6 shrink-0 text-aeblack-300" />}
                      <div>
                        <div className={cn("font-semibold", !done && "muted")}>{label.complaintStatus(stage, lang)}</div>
                        {i === stageIndex && result.updated_at && (
                          <div className="text-sm muted">{t("Last update", "آخر تحديث")}: {fmtDateTime(result.updated_at, lang)}</div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            <dl className="mt-6 grid gap-4 border-t border-aeblack-100 pt-5 text-sm sm:grid-cols-3">
              <div>
                <dt className="muted">{t("Type", "النوع")}</dt>
                <dd className="font-medium">{label.caseType(result.case_type, lang)}</dd>
              </div>
              <div>
                <dt className="muted">{t("Department", "الجهة")}</dt>
                <dd className="font-medium">{result.assigned_department ?? t("Not yet assigned", "لم تُحدَّد بعد")}</dd>
              </div>
              <div>
                <dt className="muted">{t("Case number", "رقم القضية")}</dt>
                <dd className="font-medium" dir="ltr">{result.case_number ?? "—"}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
