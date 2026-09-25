import React, { useState } from "react";
import { Mic, Play } from "lucide-react";
import { fetchBlobUrl, ApiError } from "../../../api/client";
import { useCaseStatements } from "../../../api/hooks";
import type { CaseDetailResponse, Statement } from "../../../api/types";
import { OffenceMentions, QuotedSummary } from "../../../components/ai/AI";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Skeleton, Spinner } from "../../../components/ui/core";
import { Drawer } from "../../../components/ui/overlay";
import { fmtDateTime, fmtDuration } from "../../../lib/format";
import { label } from "../../../lib/labels";
import { usePrefs } from "../../../lib/prefs";

export const TRANSCRIPT_STATUS: Record<string, [string, string]> = {
  none: ["No transcript", "لا يوجد تفريغ"],
  live: ["Recording", "قيد التسجيل"],
  queued: ["Transcribing soon", "بانتظار التفريغ"],
  processing: ["Transcribing…", "جارٍ التفريغ…"],
  done: ["Transcript ready", "التفريغ جاهز"],
  failed: ["Transcription failed", "فشل التفريغ"],
};

export const StatementsTab: React.FC<{ c: CaseDetailResponse }> = ({ c }) => {
  const { t, lang } = usePrefs();
  const statements = useCaseStatements(c.id);
  const [open, setOpen] = useState<Statement | null>(null);

  if (statements.isLoading) return <Skeleton className="h-40" />;
  if (statements.isError) return <ErrorState error={statements.error} onRetry={() => statements.refetch()} />;

  return (
    <Card title={t("Statements from the stand", "الإفادات من المنصة")} subtitle={t("Recorded one person at a time. Identity is confirmed by the clerk.", "تُسجَّل لشخص واحد في كل مرة، ويؤكد الكاتب الهوية.")} padded={false}>
      {!statements.data?.length ? (
        <EmptyState icon={<Mic className="size-7" />} title={t("No statements yet", "لا إفادات بعد")} description={t("Statements appear here after a hearing session on the courtroom stand.", "تظهر الإفادات هنا بعد جلسة على منصة الشهادة.")} />
      ) : (
        <ul className="divide-y divide-aeblack-50">
          {statements.data.map((s) => {
            const seconds = s.started_at && s.ended_at ? (new Date(s.ended_at + "Z").getTime() - new Date(s.started_at + "Z").getTime()) / 1000 : null;
            const st = TRANSCRIPT_STATUS[s.transcript_status] ?? [s.transcript_status, s.transcript_status];
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="grid size-10 place-items-center rounded-full bg-primary-50 font-bold text-primary-700">{s.sequence_number}</div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{s.person_name ?? t("Unnamed", "بدون اسم")} · {label.hearingRole(s.role, lang)}</div>
                  <div className="text-xs muted">
                    {fmtDateTime(s.started_at, lang)}{seconds != null && ` · ${fmtDuration(seconds)}`} · {t("Identity: manually confirmed", "الهوية: تأكيد يدوي من الكاتب")}
                  </div>
                  {s.transcript && <p className="mt-1 line-clamp-2 text-sm muted" dir="auto">{s.transcript}</p>}
                </div>
                <Badge tone={s.transcript_status === "done" ? "success" : s.transcript_status === "failed" ? "error" : "warning"}>
                  {lang === "ar" ? st[1] : st[0]}
                </Badge>
                <Button variant="soft" size="xs" onClick={() => setOpen(s)}>{t("Open", "فتح")}</Button>
              </li>
            );
          })}
        </ul>
      )}
      <StatementDrawer statement={open} onClose={() => setOpen(null)} />
    </Card>
  );
};

export const StatementDrawer: React.FC<{ statement: Statement | null; onClose: () => void }> = ({ statement, onClose }) => {
  const { t, lang } = usePrefs();
  const [audio, setAudio] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    setAudio((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setError(null);
  }, [statement]);

  const loadRecording = async () => {
    if (!statement) return;
    setLoading(true);
    try {
      setAudio(await fetchBlobUrl(`/courtroom/statements/${statement.id}/recording`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const isVideo = statement?.recording_content_type?.startsWith("video/");

  return (
    <Drawer open={!!statement} onOpenChange={(o) => !o && onClose()} title={statement ? `${statement.person_name ?? ""} · ${label.hearingRole(statement.role, lang)}` : ""}>
      {statement && (
        <div className="space-y-5">
          <div className="text-sm muted">{fmtDateTime(statement.started_at, lang)} → {fmtDateTime(statement.ended_at, lang)}</div>
          {statement.has_recording ? (
            audio ? (
              isVideo ? <video src={audio} controls className="w-full rounded-xl bg-black" /> : <audio src={audio} controls className="w-full" />
            ) : (
              <Button variant="outline" icon={loading ? undefined : <Play className="size-4" />} loading={loading} onClick={loadRecording}>
                {t("Play recording", "تشغيل التسجيل")}
              </Button>
            )
          ) : (
            <Alert tone="info" size="sm">{t("No recording was stored for this statement.", "لم يُحفظ تسجيل لهذه الإفادة.")}</Alert>
          )}
          {error && <Alert tone="error" size="sm">{error}</Alert>}
          {["queued", "processing"].includes(statement.transcript_status) && <Spinner label={t("Full-quality transcript in progress…", "جارٍ إعداد التفريغ الكامل…")} />}
          <QuotedSummary summary={statement.summary} />
          <OffenceMentions mentions={statement.offence_mentions} />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{t("Transcript", "التفريغ النصي")}</h3>
              {statement.transcript_source && (
                <Badge tone="neutral">
                  {statement.transcript_source === "edited" ? t("Corrected by clerk", "صحّحه الكاتب") : statement.transcript_source === "final" ? t("Full-quality", "بجودة كاملة") : t("Live", "مباشر")}
                </Badge>
              )}
            </div>
            <p className="mt-2 whitespace-pre-wrap rounded-xl bg-aeblack-50 p-4 text-sm leading-relaxed" dir="auto">
              {statement.transcript || t("No transcript.", "لا يوجد تفريغ.")}
            </p>
          </div>
          {statement.extracted_entities?.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">{t("Details mentioned", "تفاصيل مذكورة")}</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {statement.extracted_entities.slice(0, 40).map((e, i) => <Badge key={i} tone="neutral">{e.label}: {e.text}</Badge>)}
              </div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
};
