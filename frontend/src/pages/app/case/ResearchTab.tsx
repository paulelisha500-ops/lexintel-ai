import React from "react";
import { Link } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { useResearchNotes } from "../../../api/hooks";
import type { CaseDetailResponse } from "../../../api/types";
import { Badge, Card, EmptyState, Skeleton } from "../../../components/ui/core";
import { fmtDateTime } from "../../../lib/format";
import { label } from "../../../lib/labels";
import { usePrefs } from "../../../lib/prefs";

export const ResearchTab: React.FC<{ c: CaseDetailResponse }> = ({ c }) => {
  const { t, lang } = usePrefs();
  const notes = useResearchNotes(c.id);
  return (
    <Card
      title={t("Saved legal research", "البحث القانوني المحفوظ")}
      subtitle={t("Research saved to this case. Judges can reference it when entering a ruling.", "أبحاث محفوظة لهذه القضية يمكن للقاضي الرجوع إليها عند إدخال الحكم.")}
      actions={<Link to={`/app/research?case=${c.id}`} className="aegov-btn btn-sm"><BookOpen className="size-4" /> {t("Research for this case", "بحث لهذه القضية")}</Link>}
    >
      {notes.isLoading ? <Skeleton className="h-32" /> : !notes.data?.length ? (
        <EmptyState icon={<BookOpen className="size-7" />} title={t("No saved research", "لا أبحاث محفوظة")} />
      ) : (
        <ul className="space-y-4">
          {notes.data.map((n) => (
            <li key={n.id} className="rounded-xl border border-aeblack-100 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium" dir="auto">{n.question}</div>
                <span className="text-xs muted">{fmtDateTime(n.created_at, lang)}</span>
              </div>
              {n.answer && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed" dir="auto">{n.answer}</p>}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {n.citations.map((ci: any, i: number) => (
                  <Badge key={i} tone="gold">{ci.source_title} · {ci.article_label ?? ci.article} · {label.jurisdiction(ci.jurisdiction, lang)}</Badge>
                ))}
                {n.needs_human_review && <Badge tone="warning">{t("Verify against the primary text", "تحقق من النص الأصلي")}</Badge>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};
