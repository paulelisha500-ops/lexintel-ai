import React, { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ExternalLink, FileUp, Library as LibraryIcon, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { api, ApiError, uploadWithProgress } from "../../api/client";
import { useInvalidate, useLibrary, useLibraryStats } from "../../api/hooks";
import type { LawDocument } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { Alert, Badge, Button, EmptyState, ErrorState, Input, Select, StatTile } from "../../components/ui/core";
import { DataTable, FileDropzone, PageHeader, type Column } from "../../components/ui/data";
import { Menu, Modal, useConfirm } from "../../components/ui/overlay";
import { fmtBytes, fmtDate } from "../../lib/format";
import { JURISDICTIONS, label, options } from "../../lib/labels";
import { usePrefs } from "../../lib/prefs";
import { can } from "../../lib/roles";
import { ProcessingBadge } from "./shared";

export default function LibraryPage() {
  const { t, lang } = usePrefs();
  const { user } = useAuth();
  const docs = useLibrary();
  const stats = useLibraryStats();
  const invalidate = useInvalidate();
  const { confirm, element } = useConfirm();
  const [open, setOpen] = useState(false);

  const reindex = async (d: LawDocument) => {
    try {
      await api.post(`/library/documents/${d.id}/reindex`);
      await invalidate(["library"]);
      toast.success(t("Re-indexing started", "بدأت إعادة الفهرسة"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    }
  };

  const remove = async (d: LawDocument) => {
    const ok = await confirm({ title: t("Remove this law?", "إزالة هذا القانون؟"), body: t(`"${d.title}" and its ${d.article_count ?? 0} articles will be removed from research.`, `ستُزال «${d.title}» وموادها (${d.article_count ?? 0}) من البحث.`), confirmLabel: t("Remove", "إزالة"), danger: true });
    if (!ok) return;
    try {
      await api.del(`/library/documents/${d.id}`);
      await invalidate(["library"]);
      toast.success(t("Removed", "تمت الإزالة"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    }
  };

  const columns: Column<LawDocument>[] = [
    {
      key: "title", header: t("Law", "القانون"), sortValue: (d) => d.title,
      cell: (d) => (
        <div>
          <Link to={`/app/library/${d.id}`} className="font-medium hover:text-primary-700 hover:underline">{d.title}</Link>
          <div className="text-xs muted">{[d.law_number && `No. ${d.law_number}`, d.year, d.language === "ar" ? "العربية" : "English", fmtBytes(d.size_bytes)].filter(Boolean).join(" · ")}</div>
        </div>
      ),
    },
    { key: "jur", header: t("Jurisdiction", "الاختصاص"), sortValue: (d) => d.jurisdiction, cell: (d) => label.jurisdiction(d.jurisdiction, lang) },
    { key: "eff", header: t("In force", "السريان"), hideOnMobile: true, cell: (d) => (
      <span className="text-sm">{d.effective_from ? fmtDate(d.effective_from, lang) : "—"}{d.effective_to && ` → ${fmtDate(d.effective_to, lang)}`}
        {d.legislation_state !== "active" && <Badge tone="warning" className="ms-2">{d.legislation_state}</Badge>}</span>
    ) },
    { key: "status", header: t("Status", "الحالة"), cell: (d) => (
      <div>
        <ProcessingBadge status={d.status} />
        {d.status === "indexed" && <div className="mt-1 text-xs muted">{t(`${d.article_count} ${d.parse_mode === "sections" ? "sections" : "articles"}`, `${d.article_count} ${d.parse_mode === "sections" ? "قسماً" : "مادة"}`)}</div>}
        {d.error && <div className={`mt-1 max-w-xs text-xs ${d.status === "failed" ? "text-aered-600" : "muted"}`}>{d.error}</div>}
      </div>
    ) },
    { key: "actions", header: "", cell: (d) => (
      <Menu trigger={<Button variant="ghost" size="xs" iconOnly aria-label={t("Actions", "إجراءات")}><MoreHorizontal className="size-4" /></Button>}
        items={[
          ...(d.source_url ? [{ label: t("Official source", "المصدر الرسمي"), icon: <ExternalLink className="size-4" />, onSelect: () => window.open(d.source_url!, "_blank", "noopener") }] : []),
          { label: t("Re-index", "إعادة الفهرسة"), icon: <RefreshCw className="size-4" />, onSelect: () => reindex(d), disabled: !can.manageLibrary(user?.role) || d.status === "processing" },
          { label: t("Remove", "إزالة"), icon: <Trash2 className="size-4" />, danger: true, onSelect: () => remove(d), disabled: !can.deleteLibrary(user?.role) },
        ]} />
    ) },
  ];

  return (
    <div>
      <PageHeader
        title={t("Law library", "المكتبة القانونية")}
        subtitle={t("The official law texts that legal research answers from. Download the official PDF yourself from the government portal, then upload it here.",
          "النصوص القانونية الرسمية التي يعتمد عليها البحث. نزّل ملف PDF الرسمي بنفسك من البوابة الحكومية ثم ارفعه هنا.")}
        actions={can.manageLibrary(user?.role) && <Button icon={<FileUp className="size-4" />} onClick={() => setOpen(true)}>{t("Add a law", "إضافة قانون")}</Button>}
      />

      {stats.data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatTile icon={<LibraryIcon className="size-5" />} label={t("Laws indexed", "القوانين المفهرسة")} value={stats.data.indexed_documents} hint={stats.data.processing ? t(`${stats.data.processing} processing`, `${stats.data.processing} قيد المعالجة`) : undefined} />
          <StatTile tone="blue" label={t("Articles searchable", "مواد قابلة للبحث")} value={stats.data.articles} />
          <StatTile tone="neutral" label={t("By jurisdiction", "حسب الاختصاص")} value={Object.keys(stats.data.articles_by_jurisdiction).length || 0}
            hint={Object.entries(stats.data.articles_by_jurisdiction).map(([k, v]) => `${label.jurisdiction(k, lang)}: ${v}`).join(" · ") || "—"} />
        </div>
      )}

      <div className="surface overflow-hidden">
        {docs.isError ? <div className="p-5"><ErrorState error={docs.error} onRetry={() => docs.refetch()} /></div> : (
          <DataTable columns={columns} rows={docs.data} rowKey={(d) => d.id} loading={docs.isLoading}
            empty={<EmptyState icon={<LibraryIcon className="size-7" />} title={t("No laws yet", "لا قوانين بعد")}
              description={t("Start with the laws your cases rely on most, e.g. the Crimes and Penalties Law or the Labour Relations Law.", "ابدأ بالقوانين الأكثر استخداماً في قضاياك، مثل قانون الجرائم والعقوبات أو قانون علاقات العمل.")}
              action={can.manageLibrary(user?.role) && <Button onClick={() => setOpen(true)}>{t("Add a law", "إضافة قانون")}</Button>} />} />
        )}
      </div>
      <UploadLawModal open={open} onClose={() => setOpen(false)} />
      {element}
    </div>
  );
}

const UploadLawModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { t, lang } = usePrefs();
  const invalidate = useInvalidate();
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ title: "", jurisdiction: "federal", language: lang, law_number: "", year: "", effective_from: "", effective_to: "", legislation_state: "active", source_url: "" });
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!file || form.title.trim().length < 3) return setError(t("Choose a file and enter the law's title.", "اختر ملفاً وأدخل عنوان القانون."));
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    Object.entries(form).forEach(([k, v]) => { if (v) fd.append(k, v.trim()); });
    setProgress(0);
    try {
      await uploadWithProgress("/library/documents", fd, setProgress);
      await invalidate(["library"]);
      toast.success(t("Uploaded — articles are being indexed.", "تم الرفع — تجري فهرسة المواد."));
      setFile(null);
      setForm((f) => ({ ...f, title: "", law_number: "", year: "", effective_from: "", effective_to: "", source_url: "" }));
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && progress === null && onClose()} title={t("Add a law to the library", "إضافة قانون إلى المكتبة")} size="lg"
      description={t("Articles marked “Article (N)” or “المادة (N)” are indexed individually; scanned PDFs are read with OCR.", "تُفهرس المواد المعنونة «Article (N)» أو «المادة (N)» كلٌ على حدة، وتُقرأ ملفات PDF الممسوحة ضوئياً آلياً.")}
      footer={<><Button variant="outline" disabled={progress !== null} onClick={onClose}>{t("Cancel", "إلغاء")}</Button><Button loading={progress !== null} onClick={submit}>{t("Upload & index", "رفع وفهرسة")}</Button></>}>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FileDropzone accept=".pdf,.txt" maxMb={80} file={file} onFile={setFile} progress={progress} disabled={progress !== null} hint={t("Official PDF or text, up to 80 MB", "ملف PDF رسمي أو نص، حتى 80 ميغابايت")} />
        </div>
        <Input fieldClassName="sm:col-span-2" label={t("Title", "العنوان")} required value={form.title} onChange={(e) => set("title", e.target.value)} placeholder={t("e.g. Federal Decree-Law No. 33 of 2021 on Labour Relations", "مثال: مرسوم بقانون اتحادي رقم 33 لسنة 2021 بشأن تنظيم علاقات العمل")} />
        <Select label={t("Jurisdiction", "الاختصاص")} value={form.jurisdiction} onChange={(e) => set("jurisdiction", e.target.value)} options={options(JURISDICTIONS, lang)} />
        <Select label={t("Language of the text", "لغة النص")} value={form.language} onChange={(e) => set("language", e.target.value)} options={[{ value: "en", label: "English" }, { value: "ar", label: "العربية" }]} />
        <Input label={t("Law number", "رقم القانون")} value={form.law_number} onChange={(e) => set("law_number", e.target.value)} dir="ltr" />
        <Input label={t("Year", "السنة")} type="number" min={1900} max={2100} value={form.year} onChange={(e) => set("year", e.target.value)} />
        <Input label={t("In force from", "ساري منذ")} type="date" value={form.effective_from} onChange={(e) => set("effective_from", e.target.value)} />
        <Input label={t("In force until (if repealed)", "ساري حتى (إن أُلغي)")} type="date" value={form.effective_to} onChange={(e) => set("effective_to", e.target.value)} />
        <Select label={t("State", "الحالة")} value={form.legislation_state} onChange={(e) => set("legislation_state", e.target.value)}
          options={[{ value: "active", label: t("Active", "ساري") }, { value: "amended", label: t("Amended", "معدّل") }, { value: "repealed", label: t("Repealed", "ملغى") }]} />
        <Input label={t("Official source URL", "رابط المصدر الرسمي")} dir="ltr" value={form.source_url} onChange={(e) => set("source_url", e.target.value)} placeholder="https://uaelegislation.gov.ae/..." />
        {error && <Alert tone="error" className="sm:col-span-2">{error}</Alert>}
      </div>
    </Modal>
  );
};
