import React, { useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2, Download, FileSearch, FileText, Fingerprint, Flag, History, MoreHorizontal, PenLine, RefreshCw, Upload,
} from "lucide-react";
import { api, ApiError, fetchBlobUrl, uploadWithProgress } from "../../../api/client";
import { useCaseEvidence, useInvalidate } from "../../../api/hooks";
import type { AuditEntry, CaseDetailResponse, Entity, Evidence } from "../../../api/types";
import { useAuth } from "../../../auth/AuthContext";
import { LegalReferences, OffenceMentions, QuotedSummary } from "../../../components/ai/AI";
import { Alert, Badge, Button, Card, EmptyState, Input, Select, Skeleton, Spinner, Textarea } from "../../../components/ui/core";
import { FileDropzone } from "../../../components/ui/data";
import { Drawer, Menu, Modal } from "../../../components/ui/overlay";
import { fmtBytes, fmtDateTime } from "../../../lib/format";
import { EVIDENCE_TYPES, label, options } from "../../../lib/labels";
import { usePrefs } from "../../../lib/prefs";
import { can } from "../../../lib/roles";
import { ProcessingBadge } from "../shared";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.webp,.txt,.csv,.json,.docx,.doc,.xlsx,.eml,.msg,.zip,.mp3,.wav,.m4a,.ogg,.webm,.mp4,.mov";

export const EvidenceTab: React.FC<{ c: CaseDetailResponse }> = ({ c }) => {
  const { t, lang } = usePrefs();
  const { user } = useAuth();
  const evidence = useCaseEvidence(c.id);
  const invalidate = useInvalidate();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewing, setViewing] = useState<Evidence | null>(null);
  const [custody, setCustody] = useState<Evidence | null>(null);
  const [signature, setSignature] = useState<Evidence | null>(null);
  const [review, setReview] = useState<Evidence | null>(null);

  const refresh = () => invalidate(["case", c.id], ["case", c.id, "evidence"]);

  const download = async (e: Evidence) => {
    try {
      const url = await fetchBlobUrl(`/evidence/${e.id}/file`);
      const a = document.createElement("a");
      a.href = url;
      a.download = e.original_filename;
      a.target = "_blank";
      a.rel = "noopener";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    }
  };

  const verify = async (e: Evidence) => {
    try {
      const r = await api.post<{ intact: boolean; reason?: string }>(`/evidence/${e.id}/verify-integrity`);
      r.intact
        ? toast.success(t("Integrity verified: the file matches its original fingerprint.", "تم التحقق: الملف مطابق لبصمته الأصلية."))
        : toast.error(t("Integrity check FAILED: the file no longer matches its fingerprint.", "فشل التحقق: الملف لم يعد مطابقاً لبصمته."));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    }
  };

  const reprocess = async (e: Evidence) => {
    try {
      await api.post(`/evidence/${e.id}/reprocess`);
      toast.success(t("Processing restarted", "أُعيدت المعالجة"));
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    }
  };

  return (
    <Card
      title={t("Evidence", "الأدلة")}
      subtitle={t("Each file is fingerprinted (SHA-256) on upload. Views and downloads are logged.", "لكل ملف بصمة SHA-256 عند رفعه، ويُسجَّل كل اطلاع وتنزيل.")}
      actions={can.uploadEvidence(user?.role) && <Button icon={<Upload className="size-4" />} onClick={() => setUploadOpen(true)}>{t("Upload evidence", "رفع دليل")}</Button>}
      padded={false}
    >
      {evidence.isLoading ? (
        <div className="space-y-2 p-5">{[0, 1].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : !evidence.data?.length ? (
        <EmptyState icon={<FileText className="size-7" />} title={t("No evidence yet", "لا توجد أدلة بعد")}
          description={t("Upload scans, PDFs, photos or recordings. Text is extracted automatically and dates are added to the timeline.",
            "ارفع المستندات الممسوحة أو ملفات PDF أو الصور أو التسجيلات، وسيُستخرج النص تلقائياً وتُضاف التواريخ إلى التسلسل الزمني.")} />
      ) : (
        <ul className="divide-y divide-aeblack-50">
          {evidence.data.map((e) => (
            <li key={e.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start gap-4">
                <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-600">
                  <FileText className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{e.label}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs muted">
                    <span className="break-all">{e.original_filename}</span>
                    <span>{fmtBytes(e.size_bytes)}</span>
                    <span>{label.evidenceType(e.evidence_type, lang)}</span>
                    <span>{fmtDateTime(e.uploaded_at, lang)}</span>
                    <span className="font-mono" title={e.sha256}>SHA-256 {e.sha256.slice(0, 12)}…</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <ProcessingBadge status={e.processing_status} />
                    <ProcessingBadge status={e.review_status} />
                    {e.processing_status === "processing" && <Spinner />}
                    {e.text_length ? <Badge tone="neutral">{t(`${e.text_length} characters`, `${e.text_length} حرفاً`)}</Badge> : null}
                    {e.entity_count ? <Badge tone="neutral">{t(`${e.entity_count} entities`, `${e.entity_count} كياناً`)}</Badge> : null}
                    {e.ocr_confidence != null && <Badge tone="neutral">{t("OCR confidence", "دقة القراءة")} {Math.round(e.ocr_confidence * 100)}%</Badge>}
                    {e.signature_check && (
                      <Badge tone={e.signature_check.flagged_for_human_review ? "warning" : "success"}>
                        {e.signature_check.signature_present ? t("Signature found", "توقيع موجود") : t("No signature found", "لا يوجد توقيع")}
                        {e.signature_check.match_score != null && ` · ${Math.round(e.signature_check.match_score * 100)}%`}
                      </Badge>
                    )}
                  </div>
                  {e.processing_error && (
                    <p className={`mt-2 text-xs ${e.processing_status === "failed" ? "text-aered-600" : "muted"}`}>{e.processing_error}</p>
                  )}
                  {e.review_note && <p className="mt-1 text-xs muted">{t("Review note", "ملاحظة المراجعة")}: {e.review_note}</p>}
                  {e.ai_summary?.summary?.sentences?.length ? (
                    <details className="mt-2 text-sm">
                      <summary className="cursor-pointer text-xs font-medium text-primary-700">
                        {t("Key sentences", "الجمل الرئيسية")}
                        {e.ai_summary.offence_mentions.length > 0 && ` · ${t("topics", "موضوعات")}: ${e.ai_summary.offence_mentions.map((m) => (lang === "ar" ? m.label_ar : m.label_en)).join(", ")}`}
                        {e.ai_summary.legal_references.length > 0 && ` · ${t(`${e.ai_summary.legal_references.length} cited law(s)`, `${e.ai_summary.legal_references.length} قانون مذكور`)}`}
                      </summary>
                      <QuotedSummary summary={e.ai_summary.summary} className="mt-2" />
                    </details>
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  {e.processing_status === "done" && (
                    <Button variant="soft" size="xs" icon={<FileSearch className="size-3.5" />} onClick={() => setViewing(e)}>{t("Text", "النص")}</Button>
                  )}
                  <Menu
                    trigger={<Button variant="ghost" size="xs" iconOnly aria-label={t("Actions", "إجراءات")}><MoreHorizontal className="size-4" /></Button>}
                    items={[
                      { label: t("Download / open", "تنزيل / فتح"), icon: <Download className="size-4" />, onSelect: () => download(e) },
                      { label: t("Verify integrity", "التحقق من السلامة"), icon: <Fingerprint className="size-4" />, onSelect: () => verify(e) },
                      { label: t("Review", "مراجعة"), icon: <CheckCircle2 className="size-4" />, onSelect: () => setReview(e) },
                      { label: t("Check signature", "فحص التوقيع"), icon: <PenLine className="size-4" />, onSelect: () => setSignature(e), disabled: !can.uploadEvidence(user?.role) },
                      { label: t("Chain of custody", "سلسلة الحيازة"), icon: <History className="size-4" />, onSelect: () => setCustody(e) },
                      "separator",
                      { label: t("Process again", "إعادة المعالجة"), icon: <RefreshCw className="size-4" />, onSelect: () => reprocess(e), disabled: !can.uploadEvidence(user?.role) || ["queued", "processing"].includes(e.processing_status) },
                    ]}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} caseId={c.id} onDone={refresh} />
      <TextDrawer evidence={viewing} onClose={() => setViewing(null)} />
      <CustodyDrawer evidence={custody} onClose={() => setCustody(null)} />
      <SignatureModal evidence={signature} onClose={() => setSignature(null)} onDone={refresh} />
      <ReviewModal evidence={review} onClose={() => setReview(null)} onDone={refresh} />
    </Card>
  );
};

const UploadModal: React.FC<{ open: boolean; onClose: () => void; caseId: string; onDone: () => void }> = ({ open, onClose, caseId, onDone }) => {
  const { t, lang } = usePrefs();
  const [file, setFile] = useState<File | null>(null);
  const [labelText, setLabel] = useState("");
  const [type, setType] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setFile(null); setLabel(""); setType(""); setProgress(null); setError(null); };

  const upload = async () => {
    if (!file) return;
    setError(null);
    setProgress(0);
    const form = new FormData();
    form.append("file", file);
    form.append("label", labelText.trim() || file.name);
    if (type) form.append("evidence_type", type);
    try {
      await uploadWithProgress(`/cases/${caseId}/evidence`, form, setProgress);
      toast.success(t("Uploaded. Text extraction has started.", "تم الرفع وبدأ استخراج النص."));
      onDone();
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setProgress(null);
    }
  };

  return (
    <Modal open={open} onOpenChange={(o) => { if (!o && progress === null) { reset(); onClose(); } }} title={t("Upload evidence", "رفع دليل")}
      footer={<><Button variant="outline" disabled={progress !== null} onClick={() => { reset(); onClose(); }}>{t("Cancel", "إلغاء")}</Button><Button disabled={!file} loading={progress !== null} onClick={upload}>{t("Upload", "رفع")}</Button></>}>
      <div className="space-y-5">
        <FileDropzone accept={ACCEPT} maxMb={file && /\.(mp3|wav|m4a|ogg|webm|mp4|mov)$/i.test(file.name) ? 600 : 25} file={file} onFile={setFile} progress={progress} disabled={progress !== null}
          hint={t("PDF, images, text, audio/video. Documents up to 25 MB, recordings up to 600 MB.", "PDF وصور ونصوص وتسجيلات. المستندات حتى 25 ميغابايت والتسجيلات حتى 600 ميغابايت.")} />
        <Input label={t("Label", "الوصف")} placeholder={t("e.g. Police accident report", "مثال: تقرير الحادث من الشرطة")} value={labelText} onChange={(e) => setLabel(e.target.value)} />
        <Select label={t("Type", "النوع")} value={type} onChange={(e) => setType(e.target.value)} options={options(EVIDENCE_TYPES, lang)} placeholder={t("Detect automatically", "تحديد تلقائي")} />
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
};

const ENTITY_LABELS: Record<string, [string, string]> = {
  PERSON: ["People", "أشخاص"], ORG: ["Organisations", "جهات"], LOCATION: ["Places", "أماكن"], DATE: ["Dates", "تواريخ"],
  TIME: ["Times", "أوقات"], AMOUNT: ["Amounts", "مبالغ"], AMOUNT_AED: ["Amounts (AED)", "مبالغ (درهم)"], CHARGE: ["Charges named", "تهم مذكورة"],
  EVIDENCE_REF: ["Evidence references", "إشارات لأدلة"], EMIRATES_ID: ["Emirates IDs", "أرقام هويات"], CASE_REF: ["Case references", "أرقام قضايا"],
};

const TextDrawer: React.FC<{ evidence: Evidence | null; onClose: () => void }> = ({ evidence, onClose }) => {
  const { t, lang } = usePrefs();
  const [data, setData] = useState<{ text: string; entities: Entity[]; charges: string[]; meta: any } | null>(null);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (!evidence) return;
    setData(null);
    setError(null);
    api.get<any>(`/evidence/${evidence.id}/text`).then(setData).catch((e) => setError(e.message));
  }, [evidence]);

  const groups = (data?.entities ?? []).reduce<Record<string, string[]>>((acc, e) => {
    (acc[e.label] ||= []).push(e.text);
    return acc;
  }, {});

  return (
    <Drawer open={!!evidence} onOpenChange={(o) => !o && onClose()} title={evidence?.label ?? ""}>
      {error ? <Alert tone="error">{error}</Alert> : !data ? <Spinner label={t("Loading…", "جارٍ التحميل…")} /> : (
        <div className="space-y-6">
          {evidence?.ai_summary && (
            <section className="space-y-4">
              <QuotedSummary summary={evidence.ai_summary.summary} />
              <LegalReferences references={evidence.ai_summary.legal_references} />
              <OffenceMentions mentions={evidence.ai_summary.offence_mentions} />
            </section>
          )}
          {Object.keys(groups).length > 0 && (
            <section>
              <h3 className="text-sm font-semibold">{t("Extracted details", "التفاصيل المستخرجة")}</h3>
              <p className="text-xs muted">{t("Automatically extracted for convenience — check against the original.", "استُخرجت آلياً للتسهيل — راجعها مقابل الأصل.")}</p>
              <div className="mt-3 space-y-3">
                {Object.entries(groups).map(([k, vals]) => (
                  <div key={k}>
                    <div className="text-xs font-medium muted">{lang === "ar" ? ENTITY_LABELS[k]?.[1] ?? k : ENTITY_LABELS[k]?.[0] ?? k}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {[...new Set(vals)].slice(0, 30).map((v) => <Badge key={v} tone="neutral">{v}</Badge>)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section>
            <h3 className="text-sm font-semibold">{t("Full text", "النص الكامل")}</h3>
            <pre className="mt-2 max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-xl bg-aeblack-50 p-4 font-body text-sm leading-relaxed" dir="auto">
              {data.text || t("No text was found in this file.", "لم يُعثر على نص في هذا الملف.")}
            </pre>
          </section>
        </div>
      )}
    </Drawer>
  );
};

const CustodyDrawer: React.FC<{ evidence: Evidence | null; onClose: () => void }> = ({ evidence, onClose }) => {
  const { t, lang } = usePrefs();
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  React.useEffect(() => {
    if (!evidence) return;
    setItems(null);
    api.get<AuditEntry[]>(`/evidence/${evidence.id}/custody`).then(setItems).catch(() => setItems([]));
  }, [evidence]);
  return (
    <Drawer open={!!evidence} onOpenChange={(o) => !o && onClose()} title={t("Chain of custody", "سلسلة الحيازة")} width="md">
      {!items ? <Spinner /> : (
        <ol className="relative space-y-5 border-s border-aeblack-100 ps-5">
          {items.map((a) => (
            <li key={a.id} className="relative">
              <span className="absolute -start-[25px] top-1.5 size-2.5 rounded-full bg-primary-600" />
              <div className="text-sm font-medium">{a.action.replace("evidence.", "").replace(/_/g, " ")}</div>
              <div className="text-xs muted">{fmtDateTime(a.at, lang)} · {a.username ?? t("system", "النظام")} {a.role ? `(${label.systemRole(a.role, lang)})` : ""}</div>
            </li>
          ))}
        </ol>
      )}
    </Drawer>
  );
};

const SignatureModal: React.FC<{ evidence: Evidence | null; onClose: () => void; onDone: () => void }> = ({ evidence, onClose, onDone }) => {
  const { t } = usePrefs();
  const [ref, setRef] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Evidence["signature_check"]>(null);
  const [error, setError] = useState<string | null>(null);
  React.useEffect(() => { setRef(null); setResult(null); setError(null); }, [evidence]);

  const run = async () => {
    if (!evidence) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    if (ref) form.append("reference", ref);
    try {
      const updated = await api.postForm<Evidence>(`/evidence/${evidence.id}/signature-check`, form);
      setResult(updated.signature_check);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!evidence} onOpenChange={(o) => !o && onClose()} title={t("Signature check", "فحص التوقيع")}
      description={t("Document authentication only: is a signature present, and how similar is it to a reference?", "للتحقق من المستند فقط: هل يوجد توقيع، وما مدى تشابهه مع توقيع مرجعي؟")}
      footer={<><Button variant="outline" onClick={onClose}>{t("Close", "إغلاق")}</Button><Button loading={busy} onClick={run}>{t("Run check", "إجراء الفحص")}</Button></>}>
      <div className="space-y-4">
        <div className="text-sm font-medium">{t("Reference signature (optional)", "توقيع مرجعي (اختياري)")}</div>
        <FileDropzone accept=".png,.jpg,.jpeg,.pdf,.tif,.tiff" maxMb={15} file={ref} onFile={setRef} />
        {result && (
          <Alert tone={result.flagged_for_human_review ? "warning" : "success"} title={result.signature_present ? t("Signature region found", "عُثر على منطقة توقيع") : t("No signature found", "لم يُعثر على توقيع")}>
            {result.explanation}
          </Alert>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
};

const ReviewModal: React.FC<{ evidence: Evidence | null; onClose: () => void; onDone: () => void }> = ({ evidence, onClose, onDone }) => {
  const { t } = usePrefs();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  React.useEffect(() => {
    setNote(evidence?.review_note ?? "");
  }, [evidence]);

  const submit = async (status: "reviewed" | "flagged") => {
    if (!evidence) return;
    setBusy(status);
    try {
      await api.post(`/evidence/${evidence.id}/review`, { review_status: status, note: note || null });
      toast.success(status === "reviewed" ? t("Marked as reviewed", "تم وسمه كمُراجَع") : t("Flagged", "تم وضع ملاحظة"));
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={!!evidence} onOpenChange={(o) => !o && onClose()} title={t("Review evidence", "مراجعة الدليل")}
      footer={<>
        <Button variant="outline" onClick={onClose}>{t("Cancel", "إلغاء")}</Button>
        <Button variant="danger" icon={<Flag className="size-4" />} loading={busy === "flagged"} onClick={() => submit("flagged")}>{t("Flag an issue", "وضع ملاحظة")}</Button>
        <Button icon={<CheckCircle2 className="size-4" />} loading={busy === "reviewed"} onClick={() => submit("reviewed")}>{t("Mark reviewed", "وسم كمُراجَع")}</Button>
      </>}>
      <Textarea label={t("Note (optional)", "ملاحظة (اختياري)")} rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
};
