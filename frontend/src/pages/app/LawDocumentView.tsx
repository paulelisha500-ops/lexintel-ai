import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Search } from "lucide-react";
import { api } from "../../api/client";
import type { LawDocument } from "../../api/types";
import { Badge, Card, EmptyState, ErrorState, Input, Skeleton } from "../../components/ui/core";
import { PageHeader } from "../../components/ui/data";
import { cn } from "../../lib/cn";
import { fmtDate } from "../../lib/format";
import { label } from "../../lib/labels";
import { usePrefs } from "../../lib/prefs";
import { ProcessingBadge } from "./shared";

export default function LawDocumentView() {
  const { docId } = useParams();
  const { hash } = useLocation();
  const { t, lang } = usePrefs();
  const [q, setQ] = useState("");
  const data = useQuery({
    queryKey: ["library", docId, "articles"],
    queryFn: () => api.get<{ document: LawDocument; articles: { article: string; label: string; text: string }[] }>(`/library/documents/${docId}/articles`),
    enabled: !!docId,
  });

  const filtered = useMemo(() => {
    const items = data.data?.articles ?? [];
    if (!q.trim()) return items;
    const needle = q.trim().toLowerCase();
    return items.filter((a) => a.text.toLowerCase().includes(needle) || a.article === needle);
  }, [data.data, q]);

  useEffect(() => {
    if (hash && data.data) setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, [hash, data.data]);

  if (data.isLoading) return <Skeleton className="h-96" />;
  if (data.isError || !data.data) return <ErrorState error={data.error} onRetry={() => data.refetch()} />;
  const d = data.data.document;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: t("Law library", "المكتبة القانونية"), to: "/app/library" }, { label: d.title }]}
        title={d.title}
        meta={<>
          <Badge tone="neutral">{label.jurisdiction(d.jurisdiction, lang)}</Badge>
          <ProcessingBadge status={d.status} />
          {d.effective_from && <Badge tone="info">{t("In force from", "ساري منذ")} {fmtDate(d.effective_from, lang)}</Badge>}
          {d.legislation_state !== "active" && <Badge tone="warning">{d.legislation_state}</Badge>}
          {d.source_url && <a href={d.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary-700 hover:underline">{t("Official source", "المصدر الرسمي")} <ExternalLink className="size-3.5" /></a>}
        </>}
      />
      <Card>
        <Input aria-label={t("Search in this law", "ابحث في هذا القانون")} placeholder={t("Search the text or type an article number", "ابحث في النص أو اكتب رقم المادة")} prefix={<Search className="size-4" />} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="mt-6 space-y-6">
          {!filtered.length ? <EmptyState title={t("No matching articles", "لا مواد مطابقة")} /> : filtered.map((a) => (
            <article key={a.article} id={`art-${a.article}`} className={cn("scroll-mt-24 rounded-xl p-4", hash === `#art-${a.article}` && "bg-primary-50 ring-2 ring-primary-400")}>
              <h2 className="font-heading font-semibold text-primary-700">{a.label}</h2>
              <p className="mt-2 whitespace-pre-wrap leading-relaxed" dir={d.language === "ar" ? "rtl" : "ltr"}>{a.text}</p>
            </article>
          ))}
        </div>
      </Card>
    </div>
  );
}
