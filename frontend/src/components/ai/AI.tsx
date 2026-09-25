/**
 * Shared displays for LexIntel's local AI (Module 12, explainable AI):
 * drafts shown sentence by sentence with their computed sources, the live
 * drafting status, quoted summaries, offence mentions and cited laws.
 * Everything here makes it obvious what came from a document and what a
 * model wrote, and flags anything the checks couldn't match to a source.
 */
import React from "react";
import { Cpu, FileSearch, Loader2, Quote, Scale, ShieldAlert } from "lucide-react";
import type { DraftStatus, ExtractiveSummary, Grounding, LegalReference, OffenceMention } from "../../api/types";
import { cn } from "../../lib/cn";
import { usePrefs } from "../../lib/prefs";
import { Badge } from "../ui/core";
import { Tooltip } from "../ui/overlay";

/**
 * Small models format answers as markdown even when told not to; the streaming
 * view shows sentences, not asterisks. (The finished draft is cleaned server-side.)
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/(\*\*|__|`+|~~)/g, "")
    .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d{1,2}[.)]\s+)/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}

/** Small "made on this server" marker for AI output. */
export const LocalAIBadge: React.FC<{ model?: string | null; label?: string }> = ({ model, label }) => {
  const { t } = usePrefs();
  return (
    <Tooltip content={t("Runs on this court's own server. Nothing is sent to an outside AI service.", "يعمل على خادم المحكمة نفسه، ولا يُرسل أي شيء إلى خدمة ذكاء اصطناعي خارجية.")}>
      <span className="inline-flex">
        <Badge tone="info" icon={<Cpu className="size-3" />}>{label ?? t("Local AI", "ذكاء اصطناعي محلي")}{model ? ` · ${model}` : ""}</Badge>
      </span>
    </Tooltip>
  );
};

/** Where a streamed draft is: searching, waiting for the model, writing, checking. */
export const DraftStatusLine: React.FC<{ status: DraftStatus | null; className?: string }> = ({ status, className }) => {
  const { t } = usePrefs();
  if (!status) return null;
  const text = {
    retrieving: t("Searching the law library…", "جارٍ البحث في المكتبة القانونية…"),
    waiting: status.ahead
      ? t(`Waiting for the local model (${status.ahead} ahead)…`, `بانتظار النموذج المحلي (${status.ahead} قبلك)…`)
      : t("Starting the local model…", "جارٍ تشغيل النموذج المحلي…"),
    writing: t("Writing a draft on this server…", "جارٍ كتابة مسودة على هذا الخادم…"),
    checking: t("Checking every sentence against the sources…", "جارٍ مطابقة كل جملة مع المصادر…"),
  }[status.phase];
  return (
    <div className={cn("flex items-center gap-2 text-sm muted", className)} role="status" aria-live="polite">
      <Loader2 className="size-4 animate-spin text-primary-600" aria-hidden /> {text}
    </div>
  );
};

/**
 * A checked draft: one span per sentence, source numbers as chips, and any
 * sentence that matched no source visibly marked. `onCite` jumps to a source.
 */
export const GroundedText: React.FC<{ grounding: Grounding; onCite?: (n: number) => void; className?: string }> = ({ grounding, onCite, className }) => {
  const { t } = usePrefs();
  return (
    <div className={cn("leading-relaxed", className)} dir="auto">
      {grounding.sentences.map((s, i) => {
        if (s.support === "heading") return <div key={i} className="mt-2 font-semibold">{s.text}</div>;
        const body = (
          <span className={cn(
            s.support === "unsupported" && "rounded bg-aered-50 underline decoration-aered-400 decoration-wavy underline-offset-4",
            s.support === "partial" && "underline decoration-dotted decoration-aeblack-300 underline-offset-4",
          )}>{s.text}</span>
        );
        return (
          <span key={i}>
            {s.support === "unsupported" ? (
              <Tooltip content={s.invented_figures?.length
                ? t(`These figures are not in the sources: ${s.invented_figures.join(", ")}`,
                    `هذه الأرقام غير موجودة في المصادر: ${s.invented_figures.join("، ")}`)
                : t("Not found in the sources — do not rely on this sentence.", "غير موجودة في المصادر — لا تعتمد على هذه الجملة.")}>{body}</Tooltip>
            ) : s.support === "partial" ? (
              <Tooltip content={t("Only partly matches the sources — check the wording.", "تطابق المصادر جزئياً فقط — راجع الصياغة.")}>{body}</Tooltip>
            ) : body}
            {s.sources.map((n) => (
              <button key={n} type="button" onClick={() => onCite?.(n)}
                className="mx-0.5 inline-grid min-w-5 place-items-center rounded-full bg-primary-50 px-1 align-super text-[10px] font-bold text-primary-700 hover:bg-primary-100"
                aria-label={t(`Source ${n}`, `المصدر ${n}`)}>{n}</button>
            ))}{" "}
          </span>
        );
      })}
    </div>
  );
};

export const GroundingLegend: React.FC<{ grounding: Grounding }> = ({ grounding }) => {
  const { t } = usePrefs();
  const unsupported = grounding.sentences.filter((s) => s.support === "unsupported").length;
  const figuresFlagged = grounding.sentences.filter((s) => s.invented_figures?.length).length;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs muted">
      <span>{t(`${Math.round(grounding.supported_ratio * 100)}% of sentences matched a source`, `${Math.round(grounding.supported_ratio * 100)}% من الجمل تطابق مصدراً`)}</span>
      {figuresFlagged > 0 && (
        <Badge tone="error" icon={<ShieldAlert className="size-3" />}>
          {t(`${figuresFlagged} sentence(s) state figures not in the sources`, `${figuresFlagged} جملة تذكر أرقاماً غير موجودة في المصادر`)}
        </Badge>
      )}
      {unsupported > 0 && (
        <Badge tone="warning" icon={<ShieldAlert className="size-3" />}>
          {t(`${unsupported} sentence(s) not in the sources`, `${unsupported} جملة غير موجودة في المصادر`)}
        </Badge>
      )}
    </div>
  );
};

/** Original sentences picked from a document (never paraphrased). */
export const QuotedSummary: React.FC<{ summary: ExtractiveSummary | null | undefined; className?: string }> = ({ summary, className }) => {
  const { t } = usePrefs();
  if (!summary?.sentences?.length) return null;
  return (
    <div className={cn("rounded-xl border border-aeblack-100 bg-aeblack-50/60 p-3", className)}>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold muted">
        <Quote className="size-3.5" /> {t("Key sentences (quoted)", "جمل رئيسية (مقتبسة)")}
        {summary.method === "semantic" && <span className="font-normal">· {t("picked by meaning", "مختارة حسب المعنى")}</span>}
      </div>
      <ul className="space-y-1 text-sm" dir="auto">
        {summary.sentences.map((s) => <li key={s.index} className="leading-relaxed">“{s.text}”</li>)}
      </ul>
    </div>
  );
};

/** Where the file discusses an offence category — a pointer to text, never a charge. */
export const OffenceMentions: React.FC<{ mentions: OffenceMention[] | undefined; className?: string }> = ({ mentions, className }) => {
  const { t, lang } = usePrefs();
  if (!mentions?.length) return null;
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold muted">
        <FileSearch className="size-3.5" /> {t("Topics mentioned (not charges)", "موضوعات مذكورة (ليست تهماً)")}
      </div>
      <ul className="space-y-1.5">
        {mentions.map((m) => (
          <li key={m.offence} className="text-sm">
            <Badge tone="neutral">{lang === "ar" ? m.label_ar : m.label_en}</Badge>{" "}
            <span className="muted" dir="auto">“{m.sentence}”</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** Laws and articles literally cited in the text. */
export const LegalReferences: React.FC<{ references: LegalReference[] | undefined; className?: string }> = ({ references, className }) => {
  const { t } = usePrefs();
  if (!references?.length) return null;
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold muted">
        <Scale className="size-3.5" /> {t("Laws cited in the text", "قوانين مذكورة في النص")}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {references.map((r) => (
          <Tooltip key={r.reference} content={<span dir="auto">…{r.context}…</span>}>
            <span className="inline-flex"><Badge tone="gold">{r.reference}</Badge></span>
          </Tooltip>
        ))}
      </div>
    </div>
  );
};

/** Horizontal bars for a probability map (classifier output). */
export const ProbabilityBars: React.FC<{ values: Record<string, number>; label: (key: string) => string }> = ({ values, label }) => {
  const rows = Object.entries(values).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-1.5">
      {rows.map(([key, p]) => (
        <div key={key} className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-2 text-xs">
          <span className="truncate">{label(key)}</span>
          <span className="h-2 overflow-hidden rounded-full bg-aeblack-100">
            <span className="block h-full rounded-full bg-primary-500" style={{ width: `${Math.max(2, Math.round(p * 100))}%` }} />
          </span>
          <span className="text-end tabular-nums muted">{Math.round(p * 100)}%</span>
        </div>
      ))}
    </div>
  );
};
