import React from "react";
import { toast } from "sonner";
import { CheckCircle2, Cpu, DatabaseZap, RefreshCw, XCircle } from "lucide-react";
import { api, ApiError } from "../../../api/client";
import { useSystemStatus } from "../../../api/hooks";
import type { AIModelStatus, MachineMemory } from "../../../api/types";
import { Alert, Badge, Button, Card, ErrorState, KeyValue, Skeleton } from "../../../components/ui/core";
import { PageHeader } from "../../../components/ui/data";
import { usePrefs } from "../../../lib/prefs";

const SERVICE_INFO: Record<string, { name: [string, string]; role: [string, string]; fallbackKey?: string }> = {
  postgres: { name: ["PostgreSQL", "PostgreSQL"], role: ["Cases, complaints, hearings, people, rulings, audit log", "القضايا والشكاوى والجلسات والأشخاص والأحكام وسجل التدقيق"] },
  mongo: { name: ["MongoDB", "MongoDB"], role: ["Courtroom sessions, statements, evidence text", "جلسات المنصة والإفادات ونصوص الأدلة"], fallbackKey: "mongo" },
  redis: { name: ["Redis", "Redis"], role: ["Job queue and rate limits", "قائمة المهام وحدود الطلبات"] },
  elasticsearch: { name: ["Elasticsearch", "Elasticsearch"], role: ["Full-text search, duplicate complaints, similar cases, law keyword search", "البحث النصي والشكاوى المكررة والقضايا المشابهة"], fallbackKey: "elasticsearch" },
  neo4j: { name: ["Neo4j", "Neo4j"], role: ["Relationship graph: people across cases, shared citations", "شبكة العلاقات: الأشخاص عبر القضايا والإحالات المشتركة"], fallbackKey: "neo4j" },
  celery_worker: { name: ["Background worker", "المعالج الخلفي"], role: ["OCR, AI triage, law indexing, transcription, nightly jobs", "قراءة المستندات والفرز الآلي وفهرسة القوانين والتفريغ والمهام الليلية"], fallbackKey: "celery_worker" },
  llm: { name: ["Writing model", "نموذج الكتابة"], role: ["Draft research answers and case briefs (local, checked against sources)", "مسودات إجابات البحث وملخصات القضايا (محلياً، ومطابقة مع المصادر)"], fallbackKey: "llm" },
  speech_to_text: { name: ["Speech-to-text", "التفريغ الصوتي"], role: ["Live and final transcripts on the stand", "التفريغ المباشر والنهائي على المنصة"], fallbackKey: "speech_to_text" },
};

export default function System() {
  const { t, lang } = usePrefs();
  const q = useSystemStatus();

  const reindex = async () => {
    try {
      const r = await api.post<{ mode: string }>("/admin/reindex");
      toast.success(r.mode === "queued" ? t("Re-indexing queued on the worker", "أُضيفت إعادة الفهرسة إلى المعالج") : t("Re-indexing started", "بدأت إعادة الفهرسة"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <div>
      <PageHeader title={t("System status", "حالة النظام")} subtitle={t("Every service has a fallback, so an outage degrades a feature instead of breaking it.", "لكل خدمة بديل احتياطي، فيتراجع أداء الميزة عند العطل بدلاً من توقفها.")}
        actions={<>
          <Button variant="outline" icon={<RefreshCw className="size-4" />} onClick={() => q.refetch()} loading={q.isFetching}>{t("Refresh", "تحديث")}</Button>
          <Button variant="soft" icon={<DatabaseZap className="size-4" />} onClick={reindex}>{t("Rebuild search index", "إعادة بناء فهرس البحث")}</Button>
        </>} />
      {q.isLoading ? <Skeleton className="h-96" /> : q.isError || !q.data ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            {q.data.services.map((s) => {
              const info = SERVICE_INFO[s.name];
              const fallback = info?.fallbackKey ? q.data.fallbacks[info.fallbackKey] : undefined;
              return (
                <div key={s.name} className="surface p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{info ? (lang === "ar" ? info.name[1] : info.name[0]) : s.name}</div>
                      <div className="text-sm muted">{info ? (lang === "ar" ? info.role[1] : info.role[0]) : ""}</div>
                    </div>
                    {s.available ? <Badge tone="success" icon={<CheckCircle2 className="size-3" />}>{t("Running", "يعمل")}</Badge> : <Badge tone="error" icon={<XCircle className="size-3" />}>{t("Unavailable", "غير متاح")}</Badge>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 text-xs muted">
                    {s.latency_ms != null && <span>{t("Latency", "زمن الاستجابة")} {s.latency_ms} ms</span>}
                    {s.detail && <span>{s.detail}</span>}
                    {s.model && <span>{t("Model", "النموذج")}: {s.model}{s.loaded ? "" : t(" (loads on first use)", " (يُحمَّل عند أول استخدام)")}</span>}
                  </div>
                  {!s.available && (
                    <div className="mt-3 rounded-lg bg-aeblack-50 p-3 text-xs">
                      {s.error && <div className="font-mono text-aered-700">{s.error}</div>}
                      {fallback && <div className="mt-1">{t("Meanwhile: ", "في الأثناء: ")}{fallback}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {!!q.data.ai_models?.length && <AIModels models={q.data.ai_models} memory={q.data.memory} onChanged={() => q.refetch()} />}
          <Card title={t("Storage & corpus", "التخزين والمكتبة")}>
            <KeyValue columns={3} items={[
              { label: t("Upload storage free", "المساحة الحرة للملفات"), value: q.data.storage ? `${q.data.storage.free_gb} / ${q.data.storage.total_gb} GB` : "—" },
              { label: t("Law articles indexed", "المواد القانونية المفهرسة"), value: q.data.corpus.indexed_articles },
              { label: t("Articles in keyword search", "المواد في البحث النصي"), value: q.data.corpus.search_index_articles ?? "—" },
            ]} />
          </Card>
        </div>
      )}
    </div>
  );
}

const MODEL_INFO: Record<string, { role: [string, string] }> = {
  embeddings: { role: ["Meaning-matching in Arabic and English: similar cases, duplicates, summaries, key passages, the grounding check", "مطابقة المعنى بالعربية والإنجليزية: القضايا المشابهة والتكرار والملخصات والمقاطع الرئيسية وفحص المصادر"] },
  classifier: { role: ["Suggests a complaint's category from the closest earlier complaints; learns from staff decisions", "يقترح فئة الشكوى من أقرب الشكاوى السابقة ويتعلم من قرارات الموظفين"] },
  writer: { role: ["Writes short drafts for research answers and case briefs; every sentence is checked against the sources", "يكتب مسودات قصيرة لإجابات البحث وملخصات القضايا، وتُطابق كل جملة مع المصادر"] },
  speech_to_text: { role: ["Live and full-quality transcripts at the stand and for recordings", "التفريغ المباشر والكامل على المنصة وللتسجيلات"] },
  ner_en: { role: ["Names, places and dates in English documents", "الأسماء والأماكن والتواريخ في المستندات الإنجليزية"] },
  ocr: { role: ["Reads scanned documents (Arabic + English)", "قراءة المستندات الممسوحة (عربي وإنجليزي)"] },
};

const AIModels: React.FC<{ models: AIModelStatus[]; memory?: MachineMemory; onChanged: () => void }> = ({ models, memory, onChanged }) => {
  const { t, lang } = usePrefs();
  const [busy, setBusy] = React.useState<string | null>(null);

  const control = async (action: "load" | "unload") => {
    setBusy(action);
    try {
      await api.post(`/admin/ai/writer/${action}`, undefined, { timeoutMs: 300_000, retry: false });
      toast.success(action === "load" ? t("Writing model loaded", "حُمّل نموذج الكتابة") : t("Writing model unloaded", "أُفرغ نموذج الكتابة"));
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title={t("AI models on this server", "نماذج الذكاء الاصطناعي على هذا الخادم")}
      subtitle={t("All AI runs locally — nothing is sent to an outside AI service. Models load when needed and unload when idle to save memory.",
        "يعمل كل الذكاء الاصطناعي محلياً ولا يُرسل شيء إلى خدمة خارجية. تُحمّل النماذج عند الحاجة وتُفرغ عند الخمول لتوفير الذاكرة.")}>
      {memory?.free_mb != null && (
        <Alert tone={memory.can_start_writing_model ? "info" : "warning"} size="sm" className="mb-4">
          {t(`${memory.free_mb} MB of memory free on this machine.`, `${memory.free_mb} ميجابايت متاحة على هذا الجهاز.`)}{" "}
          {memory.writing_model_loaded
            ? t("The writing model is already loaded, so drafts run now.", "نموذج الكتابة محمّل بالفعل، لذا تعمل المسودات الآن.")
            : memory.can_start_writing_model
            ? t(`Enough to start the writing model (it needs ${memory.writing_model_needs_mb} MB).`,
                `تكفي لتشغيل نموذج الكتابة (يحتاج ${memory.writing_model_needs_mb} ميجابايت).`)
            : t(`Not enough to start the writing model (${memory.writing_model_needs_mb} MB needed), so drafts are skipped and the quoted sources are shown instead.`,
                `لا تكفي لتشغيل نموذج الكتابة (يحتاج ${memory.writing_model_needs_mb} ميجابايت)، لذا تُتخطى المسودات وتُعرض المصادر المقتبسة.`)}
        </Alert>
      )}
      <ul className="divide-y divide-aeblack-100">
        {models.map((m) => {
          const role = MODEL_INFO[m.key]?.role;
          const state = m.enabled === false ? ["neutral", t("Switched off", "متوقف")]
            : !m.available ? ["error", t("Unavailable", "غير متاح")]
            : m.loaded ? ["success", m.in_use ? t("Working", "يعمل الآن") : t("Loaded", "محمّل")]
            : m.loaded === null ? ["success", t("Ready", "جاهز")]
            : ["neutral", t("Idle — loads on use", "خامل — يُحمّل عند الاستخدام")];
          return (
            <li key={m.key} className="flex flex-wrap items-start gap-3 py-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary-600"><Cpu className="size-4" /></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium" dir="ltr">{m.name}</span>
                  <Badge tone={state[0] as any}>{state[1]}</Badge>
                </div>
                {role && <div className="text-sm muted">{lang === "ar" ? role[1] : role[0]}</div>}
                <div className="mt-1 flex flex-wrap gap-x-4 text-xs muted">
                  <span>{m.runtime}</span>
                  {m.memory_mb != null && m.loaded && <span>{t("Memory", "الذاكرة")} {m.memory_mb} MB</span>}
                  {m.unloads_after_seconds != null && <span>{t(`Unloads after ${Math.round(m.unloads_after_seconds / 60)} min idle`, `يُفرغ بعد ${Math.round(m.unloads_after_seconds / 60)} دقائق خمول`)}</span>}
                  {m.keep_alive && <span>{t(`Unloads after ${m.keep_alive} idle`, `يُفرغ بعد ${m.keep_alive} خمول`)}</span>}
                  {m.queue ? <span>{t(`${m.queue} draft(s) in progress`, `${m.queue} مسودة قيد الكتابة`)}</span> : null}
                  {m.examples != null && <span>{t(`${m.examples} built-in examples`, `${m.examples} مثالاً مدمجاً`)}{m.learned_examples != null && t(` + ${m.learned_examples} staff decisions`, ` + ${m.learned_examples} من قرارات الموظفين`)}</span>}
                </div>
                {m.error && <div className="mt-1 font-mono text-xs text-aered-700">{m.error}</div>}
              </div>
              {m.key === "writer" && m.enabled !== false && (
                <div className="flex gap-2">
                  {m.loaded
                    ? <Button variant="outline" size="xs" loading={busy === "unload"} onClick={() => control("unload")}>{t("Unload now", "إفراغ الآن")}</Button>
                    : <Button variant="soft" size="xs" loading={busy === "load"} disabled={!m.available} onClick={() => control("load")}>{t("Load now", "تحميل الآن")}</Button>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
};
