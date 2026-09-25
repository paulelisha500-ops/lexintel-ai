import React, { useEffect, useRef, useState } from "react";
import { FileText, PenLine, Quote, RefreshCw, Square } from "lucide-react";
import { ApiError, streamEvents } from "../../../api/client";
import { useCaseBrief } from "../../../api/hooks";
import type { BriefDraft, DraftStatus } from "../../../api/types";
import { DraftStatusLine, GroundedText, GroundingLegend, LegalReferences, LocalAIBadge, stripMarkdown } from "../../../components/ai/AI";
import { Alert, Badge, Button, Card, EmptyState, Skeleton } from "../../../components/ui/core";
import { Tooltip } from "../../../components/ui/overlay";
import { fmtDate } from "../../../lib/format";
import { usePrefs } from "../../../lib/prefs";

/**
 * The case at a glance: key sentences quoted from the description, each
 * evidence document and each statement, plus the dated timeline, topics and
 * cited laws -- instantly and without a writing model. "Write a draft brief"
 * streams a short neutral summary from the local model, checked sentence by
 * sentence against those same notes.
 */
export const CaseBriefCard: React.FC<{ caseId: string }> = ({ caseId }) => {
  const { t, lang } = usePrefs();
  const brief = useCaseBrief(caseId);
  const [status, setStatus] = useState<DraftStatus | null>(null);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<BriefDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const noteRefs = useRef<(HTMLLIElement | null)[]>([]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const write = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setDraft(null);
    setText("");
    setError(null);
    setStatus({ phase: "waiting" });
    setWriting(true);
    try {
      await streamEvents(`/cases/${caseId}/brief/stream?lang=${lang}`, {}, (event, data) => {
        if (event === "status") setStatus(data);
        else if (event === "token") setText((prev) => prev + data.text);
        else if (event === "final") {
          setDraft(data);
          setStatus(null);
        }
      }, controller.signal);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setStatus(null);
      setWriting(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setStatus(null);
    setWriting(false);
  };

  const cite = (n: number) => {
    const el = noteRefs.current[n - 1];
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.classList.add("ring-2", "ring-primary-400");
    window.setTimeout(() => el?.classList.remove("ring-2", "ring-primary-400"), 1600);
  };

  const data = brief.data;
  const hasNotes = !!data?.sections.length;
  // Mirrors the server: with fewer quotable sentences a small model mostly invents.
  const enoughToDraft = (data?.sections.reduce((n, s) => n + s.sentences.length, 0) ?? 0) >= 3;

  return (
    <Card
      title={t("Case brief", "ملخص القضية")}
      subtitle={t("Quoted from the file. Nothing here weighs evidence or suggests an outcome.", "مقتبس من الملف، ولا يزن الأدلة ولا يقترح نتيجة.")}
      actions={
        <div className="flex gap-2">
          <Tooltip content={t("Refresh the quoted facts", "تحديث الوقائع المقتبسة")}>
            <Button variant="ghost" size="xs" icon={<RefreshCw className="size-3.5" />} onClick={() => brief.refetch()} aria-label={t("Refresh", "تحديث")} />
          </Tooltip>
          {writing ? (
            <Button variant="outline" size="sm" icon={<Square className="size-3.5" />} onClick={stop}>{t("Stop", "إيقاف")}</Button>
          ) : (
            <Tooltip content={enoughToDraft ? t("A short neutral summary by the local model, checked against the key facts.", "ملخص محايد قصير يكتبه النموذج المحلي ويُطابق مع الوقائع الرئيسية.")
              : t("The file has too little text for a useful draft yet.", "الملف لا يحتوي بعد على نص كافٍ لمسودة مفيدة.")}>
              <span className="inline-flex">
                <Button variant="soft" size="sm" icon={<PenLine className="size-4" />} onClick={write} disabled={!enoughToDraft}>
                  {draft ? t("Write again", "إعادة الكتابة") : t("Write a draft brief", "كتابة مسودة ملخص")}
                </Button>
              </span>
            </Tooltip>
          )}
        </div>
      }
    >
      {brief.isLoading ? <Skeleton className="h-40" /> : brief.isError || !data ? (
        <Alert tone="warning" size="sm">{t("The brief could not be prepared just now.", "تعذر إعداد الملخص الآن.")}</Alert>
      ) : !hasNotes ? (
        <EmptyState icon={<FileText className="size-7" />} title={t("Nothing to summarise yet", "لا يوجد ما يُلخَّص بعد")}
          description={t("Add a description, evidence or statements and their key sentences appear here.", "أضف وصفاً أو أدلة أو إفادات لتظهر جملها الرئيسية هنا.")} />
      ) : (
        <div className="space-y-5">
          {(status || text || draft || error) && (
            <section className="rounded-xl border border-primary-200 bg-primary-50/40 p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide muted">
                {t("Draft brief", "مسودة الملخص")} <LocalAIBadge model={draft?.model ?? status?.model} />
              </div>
              {error ? <Alert tone="error" size="sm">{error}</Alert>
                : draft?.status === "ok" && draft.grounding ? (
                  <div className="space-y-2">
                    <GroundedText grounding={draft.grounding} onCite={cite} />
                    <GroundingLegend grounding={draft.grounding} />
                    <p className="text-xs muted">{draft.reason}</p>
                  </div>
                ) : draft ? (
                  <Alert tone={draft.status === "discarded" ? "warning" : "info"} size="sm">{draft.reason}</Alert>
                ) : (
                  <div className="space-y-2">
                    {text && <p className="whitespace-pre-wrap leading-relaxed muted" dir="auto">{stripMarkdown(text)}<span className="ms-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary-500 align-middle" /></p>}
                    <DraftStatusLine status={status} />
                  </div>
                )}
            </section>
          )}

          <section>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide muted"><Quote className="size-3.5" /> {t("Key facts in the file", "الوقائع الرئيسية في الملف")}</div>
            <ol className="space-y-2">
              {data.sections.map((s, i) => (
                <li key={i} ref={(el) => { noteRefs.current[i] = el; }} className="rounded-xl border border-aeblack-100 p-3 transition-shadow">
                  <div className="mb-1 flex items-center gap-2 text-sm">
                    <span className="grid size-6 place-items-center rounded-full bg-primary-50 text-xs font-bold text-primary-700">{i + 1}</span>
                    <span className="font-medium">{lang === "ar" ? s.label_ar : s.label}</span>
                    <Badge tone="neutral">{s.kind === "evidence" ? t("Evidence", "دليل") : s.kind === "statement" ? t("Statement", "إفادة") : t("Case", "القضية")}</Badge>
                  </div>
                  <ul className="space-y-1 text-sm leading-relaxed" dir="auto">
                    {s.sentences.map((sentence, j) => <li key={j}>“{sentence}”</li>)}
                  </ul>
                </li>
              ))}
            </ol>
          </section>

          {data.timeline.length > 0 && (
            <section>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide muted">{t("Dated events", "أحداث مؤرخة")}</div>
              <ul className="space-y-1 text-sm">
                {data.timeline.map((e, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="w-24 shrink-0 tabular-nums muted">{fmtDate(e.date, lang)}</span>
                    <span className="line-clamp-2" dir="auto">{e.description}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.offence_mentions.length > 0 && (
            <section>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide muted">{t("Topics mentioned in the file (not charges)", "موضوعات مذكورة في الملف (ليست تهماً)")}</div>
              <div className="flex flex-wrap gap-1.5">
                {data.offence_mentions.map((o) => (
                  <Tooltip key={o.offence} content={<span dir="auto">“{o.example}” — {o.sources.join(", ")}</span>}>
                    <span className="inline-flex"><Badge tone="neutral">{lang === "ar" ? o.label_ar : o.label_en} · {o.sources.length}</Badge></span>
                  </Tooltip>
                ))}
              </div>
            </section>
          )}

          <LegalReferences references={data.legal_references} />
          {data.notes.map((n) => <Alert key={n} tone="info" size="sm">{n}</Alert>)}
        </div>
      )}
    </Card>
  );
};
