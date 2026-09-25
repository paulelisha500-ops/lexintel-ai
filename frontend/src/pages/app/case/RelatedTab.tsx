import React from "react";
import { Link } from "react-router-dom";
import { GitBranch, Sparkles } from "lucide-react";
import { useRelatedCases, useSimilarCases } from "../../../api/hooks";
import type { CaseDetailResponse } from "../../../api/types";
import { LocalAIBadge } from "../../../components/ai/AI";
import { Alert, Badge, Card, EmptyState, ErrorState, Skeleton } from "../../../components/ui/core";
import { label } from "../../../lib/labels";
import { usePrefs } from "../../../lib/prefs";

export const RelatedTab: React.FC<{ c: CaseDetailResponse }> = ({ c }) => {
  const { t, lang } = usePrefs();
  const similar = useSimilarCases(c.id);
  const related = useRelatedCases(c.id);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title={t("People in other cases", "أطراف في قضايا أخرى")} subtitle={t("Parties of this case who appear in other cases.", "أطراف هذه القضية الذين يظهرون في قضايا أخرى.")}>
        {related.isLoading ? <Skeleton className="h-32" /> : related.isError ? <ErrorState error={related.error} /> : (
          <>
            {!related.data.shared_parties.length ? (
              <EmptyState icon={<GitBranch className="size-7" />} title={t("No connections found", "لا توجد ارتباطات")} className="py-8" />
            ) : (
              <ul className="space-y-3">
                {related.data.shared_parties.map((r: any, i: number) => (
                  <li key={i} className="rounded-xl border border-aeblack-100 p-3">
                    <div className="text-sm"><strong>{r.person_name ?? "—"}</strong> · {label.hearingRole(r.role_in_other_case, lang)}</div>
                    <Link to={`/app/cases/${r.case_id}`} className="mt-1 block text-sm text-primary-700 hover:underline">
                      <span dir="ltr">{r.case_number}</span> — {r.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {related.data.shared_citations.length > 0 && (
              <div className="mt-6">
                <div className="text-sm font-semibold">{t("Cases citing the same law", "قضايا تستند إلى القانون نفسه")}</div>
                <ul className="mt-2 space-y-2">
                  {related.data.shared_citations.map((r: any) => (
                    <li key={r.case_id} className="text-sm">
                      <Link to={`/app/cases/${r.case_id}`} className="text-primary-700 hover:underline"><span dir="ltr">{r.case_number}</span> — {r.title}</Link>
                      <div className="text-xs muted">{r.citations.join(" · ")}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-4 text-xs muted">{related.data.note} {related.data.source === "fallback" && t("(Graph database unavailable — computed from case records.)", "(قاعدة بيانات العلاقات غير متاحة — حُسبت من سجلات القضايا.)")}</p>
          </>
        )}
      </Card>

      <Card title={t("Similar cases", "قضايا مشابهة")}
        subtitle={t("Matched by meaning (in Arabic and English alike) and by shared wording.", "مطابقة حسب المعنى (بالعربية والإنجليزية) وحسب الكلمات المشتركة.")}
        actions={<LocalAIBadge label={t("Meaning model", "نموذج المعنى")} />}>
        {similar.data?.meaning_model_warming && (
          <Alert tone="info" size="sm" className="mb-3">
            {t("The meaning model is loading; these matches use wording only. Refresh in a minute for meaning-based matches.",
              "نموذج المعنى قيد التحميل؛ هذه النتائج بحسب الكلمات فقط. حدّث الصفحة بعد دقيقة لنتائج حسب المعنى.")}
          </Alert>
        )}
        {similar.isLoading ? <Skeleton className="h-32" /> : similar.isError || !similar.data ? <ErrorState error={similar.error} /> : !similar.data.items.length ? (
          <EmptyState icon={<Sparkles className="size-7" />} title={t("No similar cases found", "لا قضايا مشابهة")} className="py-8" />
        ) : (
          <>
            <ul className="space-y-3">
              {similar.data.items.map((s) => (
                <li key={s.case_id}>
                  <Link to={`/app/cases/${s.case_id}`} className="block rounded-xl border border-aeblack-100 p-3 hover:border-primary-300">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{s.title}</span>
                      <Badge tone="neutral">{Math.round(s.relevance * 100)}%</Badge>
                    </div>
                    <div className="mt-0.5 text-xs muted"><span dir="ltr">{s.case_number}</span> · {label.caseType(s.case_type, lang)} · {label.caseStatus(s.status, lang)}</div>
                    <div className="mt-1.5 flex flex-wrap gap-3 text-xs muted">
                      {s.meaning != null && <span>{t("Meaning", "المعنى")} {Math.round(s.meaning * 100)}%</span>}
                      {s.wording != null && <span>{t("Shared words", "كلمات مشتركة")} {Math.round(s.wording * 100)}%</span>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <Alert tone="info" size="sm" className="mt-4">{similar.data.note}</Alert>
          </>
        )}
      </Card>
    </div>
  );
};
