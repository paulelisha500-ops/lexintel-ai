import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useNavigate } from "react-router-dom";
import { BookOpen, FileText, FolderKanban, Inbox, Mic, Search, User } from "lucide-react";
import { useSearch } from "../../api/hooks";
import { usePrefs } from "../../lib/prefs";
import { Spinner } from "../ui/core";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export const CommandSearch: React.FC<{ open: boolean; onOpenChange: (o: boolean) => void }> = ({ open, onOpenChange }) => {
  const { t } = usePrefs();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const debounced = useDebounced(q, 250);
  const search = useSearch(debounced);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  const groups: { key: string; title: string; icon: React.ReactNode; go: (hit: any) => string | null }[] = [
    { key: "cases", title: t("Cases", "القضايا"), icon: <FolderKanban className="size-4" />, go: (h) => `/app/cases/${h.case_id ?? h.id}` },
    { key: "people", title: t("People", "الأشخاص"), icon: <User className="size-4" />, go: () => null },
    { key: "complaints", title: t("Complaints", "الشكاوى"), icon: <Inbox className="size-4" />, go: (h) => `/app/complaints?open=${h.id}` },
    { key: "evidence", title: t("Evidence text", "نصوص الأدلة"), icon: <FileText className="size-4" />, go: (h) => (h.case_id ? `/app/cases/${h.case_id}?tab=evidence` : null) },
    { key: "statements", title: t("Statements", "الإفادات"), icon: <Mic className="size-4" />, go: (h) => (h.case_id ? `/app/cases/${h.case_id}?tab=statements` : null) },
    { key: "law", title: t("Law articles", "المواد القانونية"), icon: <BookOpen className="size-4" />, go: (h) => (h.law_document_id ? `/app/library/${h.law_document_id}` : null) },
  ];

  const results = search.data?.results ?? {};
  const total = Object.values(results).reduce((n, list) => n + (list?.length ?? 0), 0);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-night-950/60 animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-[10vh] z-50 w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 surface shadow-2xl animate-slide-up">
          <Dialog.Title className="sr-only">{t("Search", "بحث")}</Dialog.Title>
          <Dialog.Description className="sr-only">{t("Search across LexIntel", "البحث في LexIntel")}</Dialog.Description>
          <div className="flex items-center gap-3 border-b border-aeblack-100 px-4">
            <Search className="size-5 muted" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("Search cases, people, evidence text, statements, law…", "ابحث في القضايا والأشخاص ونصوص الأدلة والإفادات والقوانين…")}
              className="h-14 flex-1 border-0 bg-transparent text-base outline-none focus:ring-0"
            />
            {search.isFetching && <Spinner />}
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-2 scrollbar-thin">
            {debounced.trim().length < 2 ? (
              <p className="px-3 py-8 text-center text-sm muted">{t("Type at least 2 characters.", "اكتب حرفين على الأقل.")}</p>
            ) : search.isError ? (
              <p className="px-3 py-8 text-center text-sm text-aered-600">{(search.error as Error).message}</p>
            ) : !search.isFetching && total === 0 ? (
              <p className="px-3 py-8 text-center text-sm muted">{t("No matches.", "لا توجد نتائج.")}</p>
            ) : (
              groups.map((g) => {
                const hits = results[g.key] ?? [];
                if (!hits.length) return null;
                return (
                  <div key={g.key} className="mb-2">
                    <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide muted">
                      {g.icon}
                      {g.title}
                    </div>
                    {hits.map((hit) => {
                      const target = g.go(hit);
                      return (
                        <button
                          key={hit.id}
                          disabled={!target}
                          onClick={() => {
                            if (target) {
                              navigate(target);
                              onOpenChange(false);
                            }
                          }}
                          className="block w-full rounded-lg px-3 py-2.5 text-start hover:bg-primary-50 disabled:cursor-default disabled:hover:bg-transparent"
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="truncate text-sm font-medium">{hit.title || "—"}</span>
                            <span className="shrink-0 text-xs muted">{hit.subtitle}</span>
                          </div>
                          {hit.snippet && (
                            <div
                              className="mt-0.5 line-clamp-2 text-xs muted [&_mark]:rounded [&_mark]:bg-primary-100 [&_mark]:px-0.5 [&_mark]:text-aeblack-900"
                              dangerouslySetInnerHTML={{ __html: sanitizeSnippet(hit.snippet) }}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
          {search.data && (
            <div className="border-t border-aeblack-100 px-4 py-2 text-[11px] muted">
              {search.data.source === "elasticsearch"
                ? t("Full-text search", "بحث نصي كامل")
                : t("Basic search (search service unavailable)", "بحث أساسي (خدمة البحث غير متاحة)")}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

/** Escapes everything, then re-allows only the <mark> tags Elasticsearch adds. */
function sanitizeSnippet(snippet: string): string {
  const escaped = snippet.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped.replace(/&lt;mark&gt;/g, "<mark>").replace(/&lt;\/mark&gt;/g, "</mark>");
}
