/**
 * The courtroom stand: one person at a time.
 *
 * Recording is real (getUserMedia + MediaRecorder). Two recorders share the
 * stream: an archival one for the whole statement (uploaded at step-down and
 * re-transcribed at full quality), and a short-cycle audio one whose 6-second
 * self-contained segments are sent for the live transcript. The camera, if
 * present, is a preview for the clerk -- identity is confirmed by the clerk,
 * and nothing analyses expression, tone or emotion.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Camera, CameraOff, CheckCircle2, DoorClosed, Mic, MicOff, Square, UserRoundPlus, Video } from "lucide-react";
import { api, ApiError, IN_BROWSER_SERVER, uploadWithProgress } from "../../../api/client";
import { useCaseParties, useInvalidate } from "../../../api/hooks";
import type { CourtroomState, Hearing, Statement } from "../../../api/types";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Input, ProgressBar, Select, Skeleton, Textarea, Toggle } from "../../../components/ui/core";
import { PageHeader } from "../../../components/ui/data";
import { Modal, Segmented, useConfirm } from "../../../components/ui/overlay";
import { cn } from "../../../lib/cn";
import { fmtDateTime, fmtDuration, fmtTime } from "../../../lib/format";
import { HEARING_ROLES, label, options } from "../../../lib/labels";
import { usePrefs } from "../../../lib/prefs";
import { StatementDrawer, TRANSCRIPT_STATUS } from "../case/StatementsTab";

const CHUNK_MS = 6000;

/** Who can be speaking while a statement is recorded (besides the person at the stand). */
const OTHER_SPEAKERS = [
  { key: "judge", en: "Judge", ar: "القاضي" },
  { key: "prosecutor", en: "Prosecutor", ar: "النيابة" },
  { key: "defense_counsel", en: "Defence counsel", ar: "الدفاع" },
  { key: "interpreter", en: "Interpreter", ar: "المترجم" },
  { key: "clerk", en: "Clerk", ar: "الكاتب" },
] as const;

type Segment = { seq: number; text: string; speaker: string };

/** Consecutive segments by the same speaker, merged into turns. */
function toTurns(segments: Segment[]): { speaker: string; text: string }[] {
  const turns: { speaker: string; text: string }[] = [];
  for (const s of [...segments].sort((a, b) => a.seq - b.seq)) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === s.speaker) last.text += " " + s.text;
    else turns.push({ speaker: s.speaker, text: s.text });
  }
  return turns;
}

/** The transcript as text: plain prose for one speaker, "Speaker: words" lines for a dialogue. */
function composeTranscript(segments: Segment[]): string {
  const turns = toTurns(segments);
  if (new Set(turns.map((t) => t.speaker)).size <= 1) return turns.map((t) => t.text).join(" ").trim();
  return turns.map((t) => `${t.speaker}: ${t.text}`).join("\n");
}

function pickMime(kind: "audio" | "video"): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = kind === "video"
    ? ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]
    : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m));
}

const extFor = (mime: string) => (mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm");

export default function Stand() {
  const { hearingId } = useParams();
  const { t, lang } = usePrefs();
  const invalidate = useInvalidate();
  const { confirm, element: confirmEl } = useConfirm();

  const [hearing, setHearing] = useState<Hearing | null>(null);
  const [state, setState] = useState<CourtroomState | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [callOpen, setCallOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [openStatement, setOpenStatement] = useState<Statement | null>(null);

  // media
  const [useVideo, setUseVideo] = useState(true);
  const [recording, setRecording] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [speakerKey, setSpeakerKey] = useState("stand");
  const speakerRef = useRef("stand");
  const cutChunkRef = useRef<(() => void) | null>(null);
  const recordStartRef = useRef<number>(0);
  const [manualTranscript, setManualTranscript] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const archiveRef = useRef<{ recorder: MediaRecorder; parts: Blob[]; mime: string } | null>(null);
  const stopChunksRef = useRef<(() => void) | null>(null);
  const chunkQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef<{ blob: Blob; seq: number; mime: string; speaker: string; offset: number }[]>([]);
  const pumpingRef = useRef(false);
  const activeIdRef = useRef<string | null>(null);

  const active = state?.active_statement ?? null;
  activeIdRef.current = active?.id ?? null;
  const sttAvailable = state?.stt.available ?? false;
  const standName = active?.person_name ?? t("Person at the stand", "الشخص على المنصة");
  const speakerName = useCallback((key: string) => {
    if (key === "stand") return standName;
    const o = OTHER_SPEAKERS.find((x) => x.key === key);
    return o ? (lang === "ar" ? o.ar : o.en) : key;
  }, [standName, lang]);
  const speakerNameRef = useRef(speakerName);
  speakerNameRef.current = speakerName;
  const liveText = composeTranscript(segments);
  const turns = toTurns(segments);

  /** Change who is speaking. The current audio chunk is cut here, so each chunk has one speaker. */
  const changeSpeaker = useCallback((key: string) => {
    if (key === speakerRef.current) return;
    speakerRef.current = key;
    setSpeakerKey(key);
    cutChunkRef.current?.();
  }, []);

  // Keys 1-6 switch the speaker while someone is at the stand (not while typing in a field).
  useEffect(() => {
    if (!active) return;
    const keys = ["stand", ...OTHER_SPEAKERS.map((o) => o.key)];
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.altKey || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return;
      const i = Number(e.key) - 1;
      if (i >= 0 && i < keys.length) { e.preventDefault(); changeSpeaker(keys[i]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, changeSpeaker]);

  const load = useCallback(async () => {
    try {
      const h = await api.get<Hearing>(`/hearings/${hearingId}`);
      setHearing(h);
      const s = await api.post<CourtroomState>(`/courtroom/hearings/${hearingId}/session`);
      setState(s);
      if (s.active_statement?.live_segments?.length) {
        setSegments(s.active_statement.live_segments.map((x) => ({ seq: x.seq, text: x.text, speaker: x.speaker || s.active_statement!.person_name || "" })));
      }
    } catch (e) {
      setLoadError(e);
    }
  }, [hearingId]);

  useEffect(() => {
    load();
  }, [load]);

  // elapsed timer for the active statement
  useEffect(() => {
    if (!active?.started_at) {
      setElapsed(0);
      return;
    }
    const started = new Date(active.started_at.endsWith("Z") ? active.started_at : active.started_at + "Z").getTime();
    const tick = () => setElapsed((Date.now() - started) / 1000);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [active?.started_at]);

  const stopMedia = useCallback((): Promise<Blob | null> => {
    stopChunksRef.current?.();
    stopChunksRef.current = null;
    const archive = archiveRef.current;
    archiveRef.current = null;
    setRecording(false);
    const release = () => {
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    if (!archive || archive.recorder.state === "inactive") {
      release();
      return Promise.resolve(archive?.parts.length ? new Blob(archive.parts, { type: archive.mime }) : null);
    }
    return new Promise((resolve) => {
      archive.recorder.onstop = () => {
        release();
        resolve(archive.parts.length ? new Blob(archive.parts, { type: archive.mime }) : null);
      };
      archive.recorder.stop();
    });
  }, []);

  useEffect(() => () => { stopMedia(); }, [stopMedia]);

  /**
   * Live chunks are transcribed one request at a time. When speech arrives faster than it is
   * transcribed, the chunks waiting from the same speaker go together in the next request
   * (browser edition), so the live transcript catches up instead of falling further behind.
   */
  const pump = async () => {
    pumpingRef.current = true;
    try {
      while (pendingRef.current.length) {
        const first = pendingRef.current.shift()!;
        const batch = [first];
        while (IN_BROWSER_SERVER && batch.length < 5 && pendingRef.current[0]?.speaker === first.speaker) batch.push(pendingRef.current.shift()!);
        const statementId = activeIdRef.current;
        const audible = batch.filter((c) => c.blob.size >= 2000);
        if (!statementId || !audible.length) continue;
        const form = new FormData();
        for (const c of audible) form.append("audio", c.blob, `chunk-${c.seq}.${extFor(c.mime)}`);
        form.append("seq", String(first.seq));
        form.append("language", lang);
        form.append("speaker", first.speaker);
        form.append("offset_seconds", String(Math.max(0, Math.round(first.offset))));
        try {
          const r = await api.postForm<{ text: string; stt_available?: boolean }>(`/courtroom/statements/${statementId}/live-chunk`, form, { timeoutMs: 120_000, retry: false });
          if (r.text) setSegments((prev) => [...prev, { seq: first.seq, text: r.text, speaker: first.speaker }]);
        } catch {
          /* a lost chunk only loses a few seconds of live text; the full recording is re-transcribed */
        }
      }
    } finally {
      pumpingRef.current = false;
    }
  };

  const sendChunk = (blob: Blob, seq: number, mime: string, speaker: string, offsetSeconds: number) => {
    pendingRef.current.push({ blob, seq, mime, speaker, offset: offsetSeconds });
    if (!pumpingRef.current) chunkQueue.current = pump();
  };

  const startMedia = async () => {
    setMediaError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMediaError(t("This browser can't record. The transcript can be typed instead.", "لا يدعم هذا المتصفح التسجيل. يمكن كتابة التفريغ يدوياً."));
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: useVideo ? { width: 640, height: 480 } : false });
    } catch (e) {
      if (useVideo) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          toast.info(t("No camera available — recording audio only.", "لا توجد كاميرا — يُسجَّل الصوت فقط."));
        } catch {
          setMediaError(t("Microphone access was blocked. Allow it in the browser, or type the transcript.", "تم حظر الوصول إلى الميكروفون. اسمح به في المتصفح أو اكتب التفريغ يدوياً."));
          return;
        }
      } else {
        setMediaError(t("Microphone access was blocked. Allow it in the browser, or type the transcript.", "تم حظر الوصول إلى الميكروفون. اسمح به في المتصفح أو اكتب التفريغ يدوياً."));
        return;
      }
    }
    streamRef.current = stream;
    const hasVideo = stream.getVideoTracks().length > 0;
    if (videoRef.current && hasVideo) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }

    const archiveMime = pickMime(hasVideo ? "video" : "audio") ?? "";
    const archiveRecorder = new MediaRecorder(stream, archiveMime ? { mimeType: archiveMime, videoBitsPerSecond: 600_000, audioBitsPerSecond: 64_000 } : undefined);
    const parts: Blob[] = [];
    archiveRecorder.ondataavailable = (e) => e.data.size && parts.push(e.data);
    archiveRecorder.start(1000);
    archiveRef.current = { recorder: archiveRecorder, parts, mime: archiveRecorder.mimeType || archiveMime || "audio/webm" };

    if (sttAvailable) {
      const audioOnly = new MediaStream(stream.getAudioTracks());
      const chunkMime = pickMime("audio") ?? "";
      let stopped = false;
      let seq = segments.length ? Math.max(...segments.map((s) => s.seq)) + 1 : 0;
      let current: MediaRecorder | null = null;
      let timer = 0;
      recordStartRef.current = Date.now();
      const cycle = () => {
        if (stopped) return;
        const rec = new MediaRecorder(audioOnly, chunkMime ? { mimeType: chunkMime } : undefined);
        const chunkParts: Blob[] = [];
        // The chunk belongs to whoever was speaking when it started; a speaker change cuts it.
        const speaker = speakerNameRef.current(speakerRef.current);
        const offset = (Date.now() - recordStartRef.current) / 1000;
        rec.ondataavailable = (e) => e.data.size && chunkParts.push(e.data);
        rec.onstop = () => {
          window.clearTimeout(timer);
          sendChunk(new Blob(chunkParts, { type: rec.mimeType }), seq++, rec.mimeType || "audio/webm", speaker, offset);
          cycle();
        };
        rec.start();
        current = rec;
        timer = window.setTimeout(() => rec.state === "recording" && rec.stop(), CHUNK_MS);
      };
      cycle();
      cutChunkRef.current = () => { if (current && current.state === "recording") current.stop(); };
      stopChunksRef.current = () => {
        stopped = true;
        cutChunkRef.current = null;
        if (current && current.state === "recording") current.stop();
      };
    }
    setRecording(true);
  };

  const onCalled = async (s: CourtroomState) => {
    setState(s);
    setSegments([]);
    setManualTranscript("");
    speakerRef.current = "stand";
    setSpeakerKey("stand");
    await startMedia();
  };

  const finishStatement = async (transcript: string) => {
    if (!state || !active) return;
    const statementId = active.id;
    const blob = await stopMedia();
    await chunkQueue.current;
    try {
      const s = await api.post<CourtroomState>(`/courtroom/sessions/${state.session.id}/step-down`, { transcript }, { retry: false });
      setState(s);
      setSegments([]);
      setReviewOpen(false);
      toast.success(t("Statement closed", "أُغلقت الإفادة"));
      if (blob && blob.size > 0) {
        const form = new FormData();
        form.append("recording", blob, `statement-${statementId}.${extFor(blob.type)}`);
        setUploadProgress(0);
        uploadWithProgress(`/courtroom/statements/${statementId}/recording`, form, setUploadProgress)
          .then(() => { toast.success(t("Recording saved", "تم حفظ التسجيل")); api.get<CourtroomState>(`/courtroom/sessions/${state.session.id}`).then(setState); })
          .catch((e) => toast.error(t("Recording upload failed: ", "فشل رفع التسجيل: ") + (e instanceof ApiError ? e.message : String(e))))
          .finally(() => setUploadProgress(null));
      }
      if (hearing) invalidate(["case", hearing.case_id]);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    }
  };

  const closeSession = async () => {
    if (!state) return;
    const ok = await confirm({ title: t("Close this session?", "إغلاق هذه الجلسة؟"), body: t("The hearing will be marked as completed.", "ستُعلَّم الجلسة كمنتهية."), confirmLabel: t("Close session", "إغلاق الجلسة") });
    if (!ok) return;
    try {
      setState(await api.post<CourtroomState>(`/courtroom/sessions/${state.session.id}/close`));
      if (hearing) invalidate(["hearings"], ["case", hearing.case_id]);
      toast.success(t("Session closed", "أُغلقت الجلسة"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    }
  };

  if (loadError) return <ErrorState error={loadError} onRetry={() => { setLoadError(null); load(); }} />;
  if (!state || !hearing) return <Skeleton className="h-96" />;
  const closed = !!state.session.session_closed_at;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: t("Courtroom stand", "منصة الشهادة"), to: "/app/courtroom" }, { label: <span dir="ltr">{hearing.case_number}</span> }]}
        title={hearing.case_title ?? t("Hearing", "جلسة")}
        meta={<>
          <Badge tone="neutral">{hearing.courtroom ?? t("No courtroom", "بدون قاعة")}</Badge>
          <Badge tone="neutral">{fmtTime(hearing.scheduled_at, lang)} · {hearing.hearing_type ?? t("Hearing", "جلسة")}</Badge>
          {hearing.judge_name && <Badge tone="neutral">{hearing.judge_name}</Badge>}
          {closed ? <Badge tone="success">{t("Session closed", "الجلسة مغلقة")}</Badge> : <Badge tone="warning">{t("Session open", "الجلسة مفتوحة")}</Badge>}
        </>}
        actions={<>
          <Link to={`/app/cases/${hearing.case_id}`} className="aegov-btn btn-outline btn-sm">{t("Case file", "ملف القضية")}</Link>
          {!closed && !active && <Button variant="outline" icon={<DoorClosed className="size-4" />} onClick={closeSession}>{t("Close session", "إغلاق الجلسة")}</Button>}
        </>}
      />

      {!sttAvailable && (
        <Alert tone="info" size="sm" className="mb-4">
          {t("Live speech-to-text is not available right now. Recording still works; type or paste the transcript at step-down.",
            "التفريغ الصوتي المباشر غير متاح حالياً. التسجيل يعمل، ويمكن كتابة التفريغ عند الانصراف.")}
        </Alert>
      )}
      {uploadProgress !== null && (
        <div className="surface mb-4 p-4">
          <div className="mb-2 text-sm">{t("Uploading the recording…", "جارٍ رفع التسجيل…")} {Math.round(uploadProgress * 100)}%</div>
          <ProgressBar value={uploadProgress} />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="space-y-6 xl:col-span-3">
          <section className="surface overflow-hidden">
            <div className="relative aspect-video bg-night-950">
              <video ref={videoRef} muted playsInline className={cn("size-full object-cover", !(recording && streamRef.current?.getVideoTracks().length) && "hidden")} />
              {!(recording && streamRef.current?.getVideoTracks().length) && (
                <div className="absolute inset-0 grid place-items-center text-white/60">
                  <div className="text-center">
                    {recording ? <Mic className="mx-auto size-12" /> : <CameraOff className="mx-auto size-12" />}
                    <div className="mt-2 text-sm">{recording ? t("Recording audio", "تسجيل صوتي") : active ? t("Recording paused", "التسجيل متوقف") : t("The stand is clear", "المنصة شاغرة")}</div>
                  </div>
                </div>
              )}
              {["top-3 start-3 border-t-2 border-s-2", "top-3 end-3 border-t-2 border-e-2", "bottom-3 start-3 border-b-2 border-s-2", "bottom-3 end-3 border-b-2 border-e-2"].map((pos) => (
                <span key={pos} className={cn("absolute size-8 rounded-sm", pos, recording ? "border-aered-500" : "border-primary-400")} />
              ))}
              {recording && (
                <div className="absolute start-4 top-4 flex items-center gap-2 rounded-full bg-night-950/70 px-3 py-1 text-sm text-white">
                  <span className="rec-dot size-2.5 rounded-full bg-aered-600" /> REC {fmtDuration(elapsed)}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 p-4">
              {active ? (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{active.person_name} · {label.hearingRole(active.role, lang)}</div>
                    <div className="text-xs muted">{t("Identity confirmed by the clerk", "هوية مؤكدة من الكاتب")} · {t("Statement", "الإفادة")} #{active.sequence_number} · {fmtDuration(elapsed)}</div>
                  </div>
                  {!recording && <Button variant="soft" icon={<Mic className="size-4" />} onClick={startMedia}>{t("Resume recording", "استئناف التسجيل")}</Button>}
                  <Button variant="danger" icon={<Square className="size-4" />} onClick={() => setReviewOpen(true)}>{t("Step down", "انصراف")}</Button>
                </>
              ) : closed ? (
                <p className="text-sm muted">{t("This session is closed.", "هذه الجلسة مغلقة.")}</p>
              ) : (
                <>
                  <Toggle checked={useVideo} onChange={setUseVideo} label={<span className="inline-flex items-center gap-1.5">{useVideo ? <Video className="size-4" /> : <Camera className="size-4" />}{t("Record video", "تسجيل الفيديو")}</span>} />
                  <Button className="ms-auto" icon={<UserRoundPlus className="size-4" />} onClick={() => setCallOpen(true)}>{t("Call to the stand", "استدعاء إلى المنصة")}</Button>
                </>
              )}
            </div>
            {mediaError && <div className="px-4 pb-4"><Alert tone="warning" size="sm" title={<span className="inline-flex items-center gap-1"><MicOff className="size-4" /> {t("Not recording", "لا يوجد تسجيل")}</span>}>{mediaError}</Alert></div>}
          </section>

          {active && (
            <Card title={t("Live transcript", "التفريغ المباشر")} subtitle={sttAvailable ? t("Updates every few seconds. Mark who is speaking so every line is attributed; you can correct it at step-down.", "يتحدّث كل بضع ثوانٍ. حدّد المتحدث لتُنسب كل عبارة إلى قائلها، ويمكن التصحيح عند الانصراف.") : undefined}>
              <SpeakerPicker current={speakerKey} standName={standName} onChange={changeSpeaker} />
              {sttAvailable ? (
                <div className="mt-4 min-h-24 space-y-3" aria-live="polite">
                  {turns.length ? turns.map((turn, i) => (
                    <div key={i} className="lex-fade-in">
                      <div className={cn("text-xs font-semibold", turn.speaker === standName ? "text-primary-700" : "text-techblue-700")}>{turn.speaker}</div>
                      <p className="whitespace-pre-wrap text-base leading-relaxed" dir="auto">{turn.text}</p>
                    </div>
                  )) : (
                    <p className="italic muted">{recording ? t("Listening…", "جارٍ الاستماع…") : t("Nothing yet.", "لا شيء بعد.")}</p>
                  )}
                </div>
              ) : (
                <Textarea label={t("Transcript (typed)", "التفريغ (كتابة)")} rows={8} value={manualTranscript} onChange={(e) => setManualTranscript(e.target.value)} dir="auto" />
              )}
            </Card>
          )}
        </div>

        <div className="xl:col-span-2">
          <Card title={t("Statements in this session", "إفادات هذه الجلسة")} padded={false}>
            {!state.statements.length ? (
              <EmptyState title={t("No statements yet", "لا إفادات بعد")} className="py-10" />
            ) : (
              <ul className="divide-y divide-aeblack-50">
                {state.statements.map((s) => {
                  const st = TRANSCRIPT_STATUS[s.transcript_status] ?? [s.transcript_status, s.transcript_status];
                  return (
                    <li key={s.id}>
                      <button onClick={() => setOpenStatement(s)} className="flex w-full items-center gap-3 px-5 py-3 text-start hover:bg-primary-50/60">
                        <span className="grid size-8 place-items-center rounded-full bg-primary-50 text-sm font-bold text-primary-700">{s.sequence_number}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{s.person_name} · {label.hearingRole(s.role, lang)}</span>
                          <span className="block text-xs muted">{fmtDateTime(s.ended_at, lang)}</span>
                        </span>
                        <Badge tone={s.transcript_status === "done" ? "success" : s.transcript_status === "failed" ? "error" : "warning"}>{lang === "ar" ? st[1] : st[0]}</Badge>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <CallToStandModal open={callOpen} onClose={() => setCallOpen(false)} sessionId={state.session.id} caseId={hearing.case_id} onCalled={onCalled} />
      <ReviewModal open={reviewOpen} onClose={() => setReviewOpen(false)} initial={sttAvailable ? liveText : manualTranscript} onConfirm={finishStatement} />
      <StatementDrawer statement={openStatement} onClose={() => setOpenStatement(null)} />
      {confirmEl}
    </div>
  );
}

const CallToStandModal: React.FC<{ open: boolean; onClose: () => void; sessionId: string; caseId: string; onCalled: (s: CourtroomState) => void }> = ({
  open, onClose, sessionId, caseId, onCalled,
}) => {
  const { t, lang } = usePrefs();
  const parties = useCaseParties(open ? caseId : undefined);
  const [mode, setMode] = useState("party");
  const [personId, setPersonId] = useState("");
  const [role, setRole] = useState("witness");
  const [name, setName] = useState("");
  const [eid, setEid] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setConfirmed(false);
  }, [open]);

  useEffect(() => {
    const p = parties.data?.find((x) => x.person.id === personId);
    if (p) setRole(p.role);
  }, [personId, parties.data]);

  const call = async () => {
    setError(null);
    if (mode === "party" && !personId) return setError(t("Choose who is stepping up.", "اختر من سيتقدم."));
    if (mode === "new" && name.trim().length < 2) return setError(t("Enter the person's name.", "أدخل اسم الشخص."));
    if (!confirmed) return setError(t("Confirm the person's identity first.", "أكّد هوية الشخص أولاً."));
    setSaving(true);
    try {
      const body = mode === "party"
        ? { role, person_id: personId, identity_confirmed_by_clerk: true }
        : { role, new_person: { full_name: name.trim(), emirates_id: eid.trim() || null, preferred_language: lang }, identity_confirmed_by_clerk: true };
      const s = await api.post<CourtroomState>(`/courtroom/sessions/${sessionId}/call-to-stand`, body, { retry: false });
      onClose();
      setPersonId(""); setName(""); setEid("");
      await onCalled(s);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={t("Call to the stand", "استدعاء إلى المنصة")}
      footer={<><Button variant="outline" onClick={onClose}>{t("Cancel", "إلغاء")}</Button><Button loading={saving} icon={<Mic className="size-4" />} onClick={call}>{t("Confirm & start recording", "تأكيد وبدء التسجيل")}</Button></>}>
      <div className="space-y-5">
        <Segmented value={mode} onChange={setMode} options={[{ value: "party", label: t("Party to the case", "طرف في القضية") }, { value: "new", label: t("Someone else", "شخص آخر") }]} />
        {mode === "party" ? (
          <Select label={t("Person", "الشخص")} value={personId} onChange={(e) => setPersonId(e.target.value)}
            options={(parties.data ?? []).map((p) => ({ value: p.person.id, label: `${p.person.full_name} (${label.hearingRole(p.role, lang)})` }))}
            placeholder={parties.isLoading ? t("Loading…", "جارٍ التحميل…") : parties.data?.length ? t("Choose…", "اختر…") : t("No parties yet — use 'Someone else'", "لا أطراف بعد — استخدم 'شخص آخر'")} />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            <Input label={t("Full name", "الاسم الكامل")} required value={name} onChange={(e) => setName(e.target.value)} />
            <Input label={t("Emirates ID (optional)", "رقم الهوية (اختياري)")} dir="ltr" placeholder="784-XXXX-XXXXXXX-X" value={eid} onChange={(e) => setEid(e.target.value)} />
          </div>
        )}
        <Select label={t("Role", "الصفة")} value={role} onChange={(e) => setRole(e.target.value)} options={options(HEARING_ROLES, lang)} />
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-primary-200 bg-primary-50/60 p-4">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1" />
          <span className="text-sm">
            <span className="flex items-center gap-1.5 font-semibold"><CheckCircle2 className="size-4 text-primary-600" /> {t("I have confirmed this person's identity", "تحققت من هوية هذا الشخص")}</span>
            <span className="muted">{t("For example against their Emirates ID card. No automatic face matching is used.", "مثلاً عبر بطاقة الهوية الإماراتية. لا تُستخدم مطابقة الوجه الآلية.")}</span>
          </span>
        </label>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
};

const ReviewModal: React.FC<{ open: boolean; onClose: () => void; initial: string; onConfirm: (transcript: string) => Promise<void> }> = ({ open, onClose, initial, onConfirm }) => {
  const { t } = usePrefs();
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setText(initial); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} onOpenChange={(o) => !o && !saving && onClose()} title={t("Step down — review the transcript", "الانصراف — مراجعة التفريغ")}
      description={t("Correct anything the live transcript misheard. The full recording will also be transcribed again at higher quality.", "صحّح ما أخطأ فيه التفريغ المباشر. سيُعاد تفريغ التسجيل الكامل بجودة أعلى أيضاً.")}
      size="lg"
      footer={<><Button variant="outline" disabled={saving} onClick={onClose}>{t("Keep recording", "متابعة التسجيل")}</Button>
        <Button variant="danger" loading={saving} icon={<Square className="size-4" />} onClick={async () => { setSaving(true); try { await onConfirm(text); } finally { setSaving(false); } }}>{t("Stop & close statement", "إيقاف وإغلاق الإفادة")}</Button></>}>
      <Textarea label={t("Transcript", "التفريغ")} rows={12} value={text} onChange={(e) => setText(e.target.value)} dir="auto" />
    </Modal>
  );
};

/** "Speaking now": the person at the stand or another participant (keys 1-6). */
const SpeakerPicker: React.FC<{ current: string; standName: string; onChange: (key: string) => void }> = ({ current, standName, onChange }) => {
  const { t, lang } = usePrefs();
  const choices = [{ key: "stand", label: standName }, ...OTHER_SPEAKERS.map((o) => ({ key: o.key, label: lang === "ar" ? o.ar : o.en }))];
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide muted">{t("Speaking now", "المتحدث الآن")}</div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("Speaking now", "المتحدث الآن")}>
        {choices.map((o, i) => (
          <button key={o.key} type="button" role="radio" aria-checked={current === o.key} onClick={() => onChange(o.key)}
            className={cn(
              "inline-flex flex-nowrap items-center justify-start gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors duration-150",
              current === o.key ? "border-primary-600 bg-primary-600 text-white shadow-sm" : "border-aeblack-200 hover:border-primary-400 hover:bg-primary-50",
            )}>
            <kbd className={cn("rounded px-1 text-[10px] font-semibold", current === o.key ? "bg-white/20" : "bg-aeblack-100 text-aeblack-600")}>{i + 1}</kbd>
            <span className="max-w-[14rem] truncate">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
