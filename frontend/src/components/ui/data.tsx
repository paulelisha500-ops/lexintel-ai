import React, { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, FileUp, UploadCloud } from "lucide-react";
import { cn } from "../../lib/cn";
import { fmtBytes } from "../../lib/format";
import { usePrefs } from "../../lib/prefs";
import { EmptyState, ProgressBar, Skeleton } from "./core";

// ---------------------------------------------------------------------------
// DataTable: sorting, row click, loading skeleton, empty state, horizontal scroll
// ---------------------------------------------------------------------------

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number | null | undefined;
  className?: string;
  hideOnMobile?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  onRowClick,
  empty,
  initialSort,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
  initialSort?: { key: string; dir: "asc" | "desc" };
}) {
  const [sort, setSort] = useState(initialSort);
  const sorted = useMemo(() => {
    if (!rows || !sort) return rows ?? [];
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va > vb ? 1 : va < vb ? -1 : 0) * factor;
    });
  }, [rows, sort, columns]);

  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    );
  }
  if (!sorted.length) return <>{empty ?? <EmptyState title="No records" />}</>;

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-aeblack-100">
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    "px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide muted",
                    c.hideOnMobile && "hidden md:table-cell",
                    c.className
                  )}
                >
                  {c.sortValue ? (
                    <button
                      className="inline-flex items-center gap-1 hover:text-primary-700"
                      onClick={() => setSort({ key: c.key, dir: active && sort?.dir === "desc" ? "asc" : "desc" })}
                    >
                      {c.header}
                      {active && (sort?.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (e) => e.key === "Enter" && onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={cn(
                "border-b border-aeblack-50 last:border-0",
                onRowClick && "cursor-pointer hover:bg-primary-50/60 focus-visible:bg-primary-50"
              )}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn("px-4 py-3 align-middle", c.hideOnMobile && "hidden md:table-cell", c.className)}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination (aegov-pagination)
// ---------------------------------------------------------------------------

export const Pagination: React.FC<{ total: number; pageSize: number; offset: number; onChange: (offset: number) => void }> = ({
  total,
  pageSize,
  offset,
  onChange,
}) => {
  const { t, dir } = usePrefs();
  const page = Math.floor(offset / pageSize) + 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const Prev = dir === "rtl" ? ChevronRight : ChevronLeft;
  const Next = dir === "rtl" ? ChevronLeft : ChevronRight;
  return (
    <nav className="aegov-pagination flex items-center justify-between gap-3 px-4 py-3" aria-label="Pagination">
      <span className="text-sm muted">
        {t(`Page ${page} of ${pages}`, `الصفحة ${page} من ${pages}`)}
      </span>
      <div className="flex gap-2">
        <button
          className="aegov-btn btn-outline btn-xs"
          disabled={page <= 1}
          onClick={() => onChange(Math.max(0, offset - pageSize))}
          aria-label={t("Previous page", "الصفحة السابقة")}
        >
          <Prev className="size-4" />
        </button>
        <button
          className="aegov-btn btn-outline btn-xs"
          disabled={page >= pages}
          onClick={() => onChange(offset + pageSize)}
          aria-label={t("Next page", "الصفحة التالية")}
        >
          <Next className="size-4" />
        </button>
      </div>
    </nav>
  );
};

// ---------------------------------------------------------------------------
// Breadcrumbs + page header
// ---------------------------------------------------------------------------

export const Breadcrumbs: React.FC<{ items: { label: React.ReactNode; to?: string }[] }> = ({ items }) => {
  const { dir } = usePrefs();
  const Sep = dir === "rtl" ? ChevronLeft : ChevronRight;
  return (
    <nav aria-label="Breadcrumb" className="aegov-breadcrumb mb-2">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm muted">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {item.to ? (
              <Link to={item.to} className="hover:text-primary-700 hover:underline">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-aeblack-800">
                {item.label}
              </span>
            )}
            {i < items.length - 1 && <Sep className="size-3.5 opacity-60" aria-hidden />}
          </li>
        ))}
      </ol>
    </nav>
  );
};

export const PageHeader: React.FC<{
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  eyebrow?: React.ReactNode;
  breadcrumbs?: { label: React.ReactNode; to?: string }[];
  actions?: React.ReactNode;
  meta?: React.ReactNode;
}> = ({ title, subtitle, eyebrow, breadcrumbs, actions, meta }) => (
  <div className="mb-6">
    {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-primary-600">{eyebrow}</div>}
        <h1 className="font-heading text-2xl font-bold leading-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-3xl text-sm muted sm:text-base">{subtitle}</p>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Stepper (aegov-step)
// ---------------------------------------------------------------------------

export const Stepper: React.FC<{ steps: string[]; current: number }> = ({ steps, current }) => (
  <ol className="flex flex-wrap items-center gap-3">
    {steps.map((s, i) => {
      const state = i < current ? "done" : i === current ? "current" : "upcoming";
      return (
        <li key={s} className="flex items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
          <span
            aria-hidden
            className={cn(
              "grid size-7 place-items-center rounded-full text-xs font-bold",
              state === "done" && "bg-primary-600 text-white",
              state === "current" && "bg-primary-100 text-primary-800 ring-2 ring-primary-600",
              state === "upcoming" && "bg-aeblack-100 text-aeblack-500"
            )}
          >
            {i + 1}
          </span>
          <span className={cn("text-sm", state === "current" ? "font-semibold" : "muted")}>
            <span className="sr-only">{`${i + 1}. `}</span>{s}
          </span>
          {i < steps.length - 1 && <span aria-hidden className="hidden h-px w-8 bg-aeblack-200 sm:block" />}
        </li>
      );
    })}
  </ol>
);

// ---------------------------------------------------------------------------
// File dropzone with upload progress (aegov-form-control dropbox look)
// ---------------------------------------------------------------------------

export const FileDropzone: React.FC<{
  accept?: string;
  maxMb: number;
  file: File | null;
  onFile: (file: File | null) => void;
  progress?: number | null;
  disabled?: boolean;
  hint?: React.ReactNode;
}> = ({ accept, maxMb, file, onFile, progress, disabled, hint }) => {
  const { t } = usePrefs();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = (f: File | undefined | null) => {
    setError(null);
    if (!f) return;
    if (f.size > maxMb * 1024 * 1024) {
      setError(t(`File is larger than ${maxMb} MB.`, `حجم الملف أكبر من ${maxMb} ميغابايت.`));
      return;
    }
    onFile(f);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-disabled={disabled}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !disabled && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!disabled) choose(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition",
          drag ? "border-primary-600 bg-primary-50" : "border-primary-300 hover:border-primary-500",
          disabled && "cursor-not-allowed opacity-60"
        )}
      >
        {file ? <FileUp className="size-8 text-primary-600" /> : <UploadCloud className="size-8 text-primary-600" />}
        {file ? (
          <div>
            <div className="font-medium break-all">{file.name}</div>
            <div className="text-xs muted">{fmtBytes(file.size)}</div>
          </div>
        ) : (
          <div>
            <div className="font-medium text-primary-700">
              {t("Drop a file here or click to browse", "اسحب ملفاً هنا أو انقر للاختيار")}
            </div>
            <div className="text-xs muted">{hint ?? t(`Up to ${maxMb} MB`, `حتى ${maxMb} ميغابايت`)}</div>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {progress != null && <ProgressBar value={progress} className="mt-3" />}
      {error && <p className="mt-2 text-sm text-aered-600">{error}</p>}
    </div>
  );
};
