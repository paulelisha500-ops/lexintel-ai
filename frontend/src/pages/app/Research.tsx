import React, { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { BookmarkPlus, BookOpen, ExternalLink, Library, Quote, Send, ShieldAlert, Square } from "lucide-react";
import { api, ApiError, streamEvents } from "../../api/client";
import { useCase, useLibraryStats } from "../../api/hooks";
import type { DraftStatus, ResearchResult } from "../../api/types";
import { DraftStatusLine, GroundedText, GroundingLegend, LocalAIBadge, stripMarkdown } from "../../components/ai/AI";
import { Alert, Badge, Button, Card, EmptyState, Input, Select } from "../../components/ui/core";
import { PageHeader } from "../../components/ui/data";
import { fmtDate } from "../../lib/format";
import { JURISDICTIONS, label, options } from "../../lib/labels";
import { usePrefs } from "../../lib/prefs";

interface Turn {
  id: number;
  question: string;
  asOf?: string;
  jurisdiction?: string;
  status: DraftStatus | null;     // live phase while streaming
  sources: ResearchResult | null; // arrives first: citations + key passages
  draft: string;                  // raw text as the model writes it
  final: ResearchResult | null;   // checked result
  error: string | null;
  stopped?: boolean;
  savedTo?: string;
}

export default function Research() {
  const { t, lang } = usePrefs();
  const [params] = useSearchParams();
  const caseId = params.get("case") ?? undefined;
  const linkedCase = useCase(caseId);
  const stats = useLibraryStats();
  const [question, setQuestion] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [asOf, setAsOf] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const update = (id: number, patch: Partial<Turn> | ((tr: Turn) => Partial<Turn>)) =>
    setTurns((prev) => prev.map((tr) => (tr.id === id ? { ...tr, ...(typeof patch === "function" ? patch(tr) : patch) } : tr)));

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = question.trim();
    if (q.length < 3 || busy) return;
    setQuestion("");
    const id = Date.now();
    setTurns((prev) => [...prev, { id, question: q, asOf, jurisdiction, status: { phase: "retrieving" }, sources: null, draft: "", final: null, error: null }]);
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      await streamEvents("/research/ask/stream", { question: q, as_of_date: asOf || undefined, jurisdiction: jurisdiction || undefined },
        (event, data) => {
          if (event === "status") update(id, { status: data });
          else if (event === "sources") update(id, { sources: data });
          else if (event === "token") update(id, (tr) => ({ draft: tr.draft + data.text }));
          else if (event === "final") update(id, { final: data, status: null });
        }, controller.signal);
      update(id, (tr) => (tr.final ? {} : { status: null, stopped: controller.signal.aborted }));
    } catch (err) {
      update(id, { error: err instanceof ApiError ? err.message : String(err), status: null });
      setQuestion(q);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const save = async (turn: Turn) => {
    const result = turn.final ?? turn.sources;
    if (!caseId || !result) return;
    try {
      await api.post(`/cases/${caseId}/research-notes`, {
        question: turn.question, answer: turn.final?.answer_status === "ok" ? turn.final.answer : "",
        citations: result.citations, confidence: result.confidence, needs_human_review: true,
      }, { retry: false });
      update(turn.id, { savedTo: caseId });
      toast.success(t("Saved to the case", "حُفظ في القضية"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    }
  };

  const empty = stats.data && !stats.data.corpus_available;

  return (
    <div>
      <PageHeader
        title={t("Legal research", "البحث القانوني")}
        subtitle={t("Answers come only from the law texts in the Law Library, with article citations. It explains the law — it never predicts outcomes.",
          "تأتي الإجابات حصراً من النصوص في المكتبة القانونية مع الإحالة إلى المواد، وهي تشرح القانون ولا تتنبأ بالأحكام.")}
        meta={stats.data && (
          <Badge tone="neutral" icon={<Library className="size-3" />}>
            {t(`${stats.data.articles} articles indexed`, `${stats.data.articles} مادة مفهرسة`)}
          </Badge>
        )}
      />

      {linkedCase.data && (
        <Alert tone="info" size="sm" className="mb-4">
          {t("Researching for case", "بحث لصالح القضية")}{" "}
          <Link to={`/app/cases/${caseId}?tab=research`} className="font-semibold underline"><span dir="ltr">{linkedCase.data.case_number}</span> — {linkedCase.data.title}</Link>.{" "}
          {t("You can save answers to it.", "يمكنك حفظ الإجابات فيها.")}
        </Alert>
      )}

      {empty && (
        <Alert tone="warning" className="mb-4" title={t("The Law Library is empty", "المكتبة القانونية فارغة")}
          action={<Link to="/app/library" className="aegov-btn btn-sm">{t("Open the Law Library", "فتح المكتبة القانونية")}</Link>}>
          {t("Official UAE statute portals block automated downloads, so laws are added by uploading the official PDF.",
            "تحجب بوابات التشريعات الرسمية التنزيل الآلي، لذا تُضاف القوانين برفع ملف PDF الرسمي.")}
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <div className="space-y-6">
            {turns.length === 0 && (
              <div className="surface overflow-hidden">
                <img src="/images/law-books.jpg" alt="" className="h-40 w-full object-cover" />
                <EmptyState icon={<BookOpen className="size-7" />} title={t("Ask a question about UAE law", "اطرح سؤالاً عن القانون الإماراتي")}
                  description={t("For example: “What notice period applies when terminating an employment contract?”", "مثال: «ما مدة الإشعار عند إنهاء عقد العمل؟»")} />
              </div>
            )}
            {turns.map((turn) => (
              <div key={turn.id} className="space-y-3">
                <div className="ms-auto max-w-2xl rounded-2xl rounded-ee-sm bg-primary-600 px-4 py-3 text-white" dir="auto">
                  {turn.question}
                  {(turn.jurisdiction || turn.asOf) && (
                    <div className="mt-1 text-xs text-white/75">
                      {turn.jurisdiction && label.jurisdiction(turn.jurisdiction, lang)}{turn.jurisdiction && turn.asOf && " · "}{turn.asOf && `${t("law as of", "القانون بتاريخ")} ${fmtDate(turn.asOf, lang)}`}
                    </div>
                  )}
                </div>
                <Card>
                  <TurnView turn={turn} onStop={busy && !turn.final ? stop : undefined}
                    onSave={caseId && !turn.savedTo && (turn.final || turn.sources) ? () => save(turn) : undefined} />
                </Card>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <form onSubmit={submit} className="surface sticky bottom-4 mt-6 flex items-end gap-3 p-3 shadow-lg">
            <div className="flex-1">
              <Input aria-label={t("Your question", "سؤالك")} placeholder={t("Ask about UAE law…", "اسأل عن القانون الإماراتي…")} value={question} onChange={(e) => setQuestion(e.target.value)} dir="auto" />
            </div>
            <Button type="submit" size="base" loading={busy} disabled={question.trim().length < 3} icon={<Send className="size-4" />}>{t("Ask", "اسأل")}</Button>
          </form>
        </div>

        <aside className="space-y-4">
          <Card title={t("Filters", "عوامل التصفية")}>
            <div className="space-y-4">
              <Select label={t("Jurisdiction", "الاختصاص")} value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} options={options(JURISDICTIONS, lang)} placeholder={t("All", "الكل")} />
              <Input label={t("Law in force on", "القانون الساري بتاريخ")} type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} hint={t("Leave empty for today. Repealed law is excluded.", "اتركه فارغاً لليوم. يُستبعد القانون الملغى.")} />
            </div>
          </Card>
          <Card title={t("How answers are made", "كيف تُعدّ الإجابات")}>
            <ol className="list-decimal space-y-2 ps-4 text-sm muted">
              <li>{t("The library is searched by meaning and by keyword; law not in force on the date is removed.", "يُبحث في المكتبة حسب المعنى والكلمات، ويُستبعد القانون غير الساري في التاريخ.")}</li>
              <li>{t("The sentences that answer the question are quoted from the articles.", "تُقتبس من المواد الجمل التي تجيب عن السؤال.")}</li>
              <li>{t("A small model on this server writes a short draft from those articles only.", "يكتب نموذج صغير على هذا الخادم مسودة قصيرة من تلك المواد فقط.")}</li>
              <li>{t("Every sentence of the draft is checked against the articles; anything not found is marked.", "تُطابق كل جملة من المسودة مع المواد، ويُعلَّم ما لا يوجد فيها.")}</li>
            </ol>
          </Card>
          <Alert tone="info" size="sm" title={t("Always verify", "تحقق دائماً")}>
            {t("Check every citation against the official text before relying on it.", "راجع كل إحالة مقابل النص الرسمي قبل الاعتماد عليها.")}
          </Alert>
        </aside>
      </div>
    </div>
  );
}

const TurnView: React.FC<{ turn: Turn; onStop?: () => void; onSave?: () => void }> = ({ turn, onStop, onSave }) => {
  const { t } = usePrefs();
  const sourcesRef = useRef<HTMLOListElement>(null);
  const result = turn.final ?? turn.sources;

  if (turn.error) return <Alert tone="error">{turn.error}</Alert>;
  if (!result) return <DraftStatusLine status={turn.status} />;
  if (result.status === "no_corpus" || result.answer_status === "no_corpus") return <Alert tone="warning">{result.review_reason}</Alert>;
  if (result.answer_status === "no_sources") return <Alert tone="warning">{result.review_reason}</Alert>;

  const cite = (n: number) => {
    const el = sourcesRef.current?.children[n - 1] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.classList.add("ring-2", "ring-primary-400");
    window.setTimeout(() => el?.classList.remove("ring-2", "ring-primary-400"), 1600);
  };

  return (
    <div className="space-y-5">
      {/* 1. The draft: streaming text, then the checked version */}
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide muted">{t("Answer", "الإجابة")}</span>
          {(turn.status?.phase === "writing" || turn.final?.answer_status === "ok") && <LocalAIBadge model={turn.final?.model ?? turn.status?.model} />}
          {onStop && <Button variant="ghost" size="xs" className="ms-auto" icon={<Square className="size-3" />} onClick={onStop}>{t("Stop", "إيقاف")}</Button>}
        </div>
        {turn.final?.answer_status === "ok" && turn.final.grounding ? (
          <div className="space-y-2">
            <GroundedText grounding={turn.final.grounding} onCite={cite} />
            <GroundingLegend grounding={turn.final.grounding} />
          </div>
        ) : turn.final ? (
          <Alert tone={turn.final.answer_status === "discarded" ? "warning" : "info"} size="sm">{turn.final.review_reason}</Alert>
        ) : turn.stopped ? (
          <Alert tone="info" size="sm">{t("Stopped. The sources below are complete.", "تم الإيقاف. المصادر أدناه كاملة.")}</Alert>
        ) : (
          <div className="space-y-2">
            {turn.draft && <p className="whitespace-pre-wrap leading-relaxed muted" dir="auto">{stripMarkdown(turn.draft)}<span className="ms-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary-500 align-middle" /></p>}
            <DraftStatusLine status={turn.status} />
          </div>
        )}
      </section>

      {/* 2. Key passages: quoted, available before any draft */}
      {result.key_passages?.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide muted"><Quote className="size-3.5" /> {t("Key passages from the law", "مقاطع رئيسية من القانون")}</div>
          <ul className="space-y-2">
            {result.key_passages.map((p, i) => (
              <li key={i} className="flex gap-2 rounded-xl bg-gold-100/40 p-3 text-sm leading-relaxed">
                <button type="button" onClick={() => cite(p.source_number)} className="grid size-6 shrink-0 place-items-center rounded-full bg-primary-50 text-xs font-bold text-primary-700">{p.source_number}</button>
                <span dir="auto">“{p.text}”</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 3. Sources */}
      {result.citations.length > 0 && (
        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide muted">{t("Sources", "المصادر")}</div>
          <ol ref={sourcesRef} className="space-y-2">
            {result.citations.map((c, i) => <CitationItem key={i} n={i + 1} c={c} />)}
          </ol>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-aeblack-100 pt-3 text-xs muted">
        <span>{t("Confidence", "الثقة")} {Math.round(result.confidence * 100)}%</span>
        {result.retrieval_sources.length > 0 && <span>· {t("Retrieval", "الاسترجاع")}: {result.retrieval_sources.join(" + ")}</span>}
        <Badge tone="warning" icon={<ShieldAlert className="size-3" />}>{t("Verify before relying on this", "تحقق قبل الاعتماد")}</Badge>
        {onSave && <Button variant="soft" size="xs" className="ms-auto" icon={<BookmarkPlus className="size-3.5" />} onClick={onSave}>{t("Save to case", "حفظ في القضية")}</Button>}
        {turn.savedTo && <Badge tone="success" className="ms-auto">{t("Saved", "محفوظ")}</Badge>}
      </div>
    </div>
  );
};

const CitationItem: React.FC<{ n: number; c: ResearchResult["citations"][number] }> = ({ n, c }) => {
  const { t, lang } = usePrefs();
  return (
    <li className="rounded-xl border border-aeblack-100 p-3 transition-shadow">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="grid size-6 place-items-center rounded-full bg-primary-50 text-xs font-bold text-primary-700">{n}</span>
        <span className="font-medium">{c.source_title}</span>
        <Badge tone="gold">{c.article_label ?? c.article}</Badge>
        <Badge tone="neutral">{label.jurisdiction(c.jurisdiction, lang)}</Badge>
        {c.effective_from && <span className="text-xs muted">{t("in force from", "ساري منذ")} {fmtDate(c.effective_from, lang)}</span>}
        <span className="ms-auto flex gap-2">
          {c.law_document_id && <Link to={`/app/library/${c.law_document_id}#art-${c.article}`} className="text-xs text-primary-700 hover:underline">{t("Read article", "قراءة المادة")}</Link>}
          {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary-700 hover:underline">{t("Official source", "المصدر الرسمي")} <ExternalLink className="size-3" /></a>}
        </span>
      </div>
      <p className="mt-2 line-clamp-4 text-sm muted" dir="auto">{c.excerpt}</p>
    </li>
  );
};
