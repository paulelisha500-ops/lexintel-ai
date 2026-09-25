/**
 * Charts, following the dataviz specs: single-series marks in the brand gold,
 * bars <= 24px with a 4px rounded data-end, 2px lines with a ~10% area wash,
 * hairline recessive grid, hover tooltips, selective labels, and a table view
 * for every chart. Colors are read from the live CSS tokens so dark mode gets
 * its own validated steps rather than a naive flip.
 */
import React, { useEffect, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Table2, BarChart3 } from "lucide-react";
import { cn } from "../lib/cn";
import { usePrefs } from "../lib/prefs";

function readToken(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function useChartTokens() {
  const { theme } = usePrefs();
  const [tokens, setTokens] = useState(() => compute());
  function compute() {
    return {
      series: readToken("--color-primary-600", "#92722a"),
      grid: readToken("--color-aeblack-100", "#e1e3e5"),
      axis: readToken("--color-aeblack-500", "#5f646d"),
      surface: readToken("--color-whitely-50", "#ffffff"),
      tooltipBg: readToken("--color-aeblack-900", "#1b1d21"),
      ramp: [
        readToken("--color-aegold-300", "#d7bc6d"),
        readToken("--color-aegold-500", "#b68a35"),
        readToken("--color-aegold-700", "#7c5e24"),
      ],
    };
  }
  useEffect(() => {
    const id = requestAnimationFrame(() => setTokens(compute()));
    return () => cancelAnimationFrame(id);
  }, [theme]);
  return tokens;
}

const ChartTooltip: React.FC<any> = ({ active, payload, label, valueLabel, formatLabel }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-night-900 px-3 py-2 text-xs text-white shadow-lg">
      <div className="font-medium">{formatLabel ? formatLabel(label) : label}</div>
      <div className="mt-0.5 tabular-nums">
        {valueLabel}: <span className="font-semibold">{payload[0].value}</span>
      </div>
    </div>
  );
};

interface ChartFrameProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  table: { head: [string, string]; rows: [React.ReactNode, React.ReactNode][] };
  children: React.ReactNode;
  className?: string;
  empty?: boolean;
}

export const ChartFrame: React.FC<ChartFrameProps> = ({ title, subtitle, table, children, className, empty }) => {
  const { t } = usePrefs();
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <section className={cn("surface p-5", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{title}</h3>
          {subtitle && <p className="mt-0.5 text-sm muted">{subtitle}</p>}
        </div>
        <button
          onClick={() => setView((v) => (v === "chart" ? "table" : "chart"))}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs muted hover:bg-aeblack-50"
          aria-pressed={view === "table"}
        >
          {view === "chart" ? <Table2 className="size-3.5" /> : <BarChart3 className="size-3.5" />}
          {view === "chart" ? t("Table", "جدول") : t("Chart", "رسم")}
        </button>
      </div>
      {empty ? (
        <div className="grid h-48 place-items-center text-sm muted">{t("No data yet", "لا توجد بيانات بعد")}</div>
      ) : view === "chart" ? (
        children
      ) : (
        <div className="max-h-64 overflow-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-aeblack-100">
                <th className="py-2 text-start font-medium muted">{table.head[0]}</th>
                <th className="py-2 text-end font-medium muted">{table.head[1]}</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-b border-aeblack-50 last:border-0">
                  <td className="py-1.5">{r[0]}</td>
                  <td className="py-1.5 text-end tabular-nums">{r[1]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export const ColumnChart: React.FC<{
  data: { label: string; value: number }[];
  valueLabel: string;
  height?: number;
  labelMaxOnly?: boolean;
}> = ({ data, valueLabel, height = 220, labelMaxOnly = true }) => {
  const c = useChartTokens();
  const { dir } = usePrefs();
  const max = Math.max(0, ...data.map((d) => d.value));
  return (
    <div style={{ height }} dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dir === "rtl" ? [...data].reverse() : data} margin={{ top: 18, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={c.grid} strokeWidth={1} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: c.grid }} tick={{ fill: c.axis, fontSize: 11 }} interval="preserveStartEnd" minTickGap={8} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: c.axis, fontSize: 11 }} width={40} orientation={dir === "rtl" ? "right" : "left"} />
          <Tooltip cursor={{ fill: c.grid, opacity: 0.5 }} content={<ChartTooltip valueLabel={valueLabel} />} />
          <Bar dataKey="value" fill={c.series} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            <LabelList
              dataKey="value"
              position="top"
              className="fill-current"
              style={{ fill: c.axis, fontSize: 11 }}
              formatter={(v: unknown) => (!labelMaxOnly || (Number(v) === max && max > 0) ? String(v) : "")}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export const TrendChart: React.FC<{
  data: { label: string; value: number }[];
  valueLabel: string;
  height?: number;
}> = ({ data, valueLabel, height = 220 }) => {
  const c = useChartTokens();
  const { dir } = usePrefs();
  const id = React.useId().replace(/:/g, "");
  return (
    <div style={{ height }} dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={dir === "rtl" ? [...data].reverse() : data} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id={`wash-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c.series} stopOpacity={0.12} />
              <stop offset="100%" stopColor={c.series} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={c.grid} strokeWidth={1} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: c.grid }} tick={{ fill: c.axis, fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: c.axis, fontSize: 11 }} width={40} orientation={dir === "rtl" ? "right" : "left"} />
          <Tooltip cursor={{ stroke: c.axis, strokeWidth: 1 }} content={<ChartTooltip valueLabel={valueLabel} />} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={c.series}
            strokeWidth={2}
            fill={`url(#wash-${id})`}
            isAnimationActive={false}
            activeDot={{ r: 5, fill: c.series, stroke: c.surface, strokeWidth: 2 }}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

/** Horizontal bars in plain HTML: readable labels in both scripts, value at the tip. */
export const BarList: React.FC<{
  items: { key: string; label: string; value: number; colorIndex?: number }[];
  ramp?: boolean;
  onSelect?: (key: string) => void;
}> = ({ items, ramp, onSelect }) => {
  const c = useChartTokens();
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const color = ramp && item.colorIndex !== undefined ? c.ramp[item.colorIndex] : c.series;
        const Comp = onSelect ? "button" : "div";
        return (
          <li key={item.key}>
            <Comp
              onClick={onSelect ? () => onSelect(item.key) : undefined}
              className={cn("group block w-full text-start", onSelect && "rounded-lg focus-visible:outline-2")}
              title={`${item.label}: ${item.value}`}
            >
              <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <span className={cn(onSelect && "group-hover:text-primary-700")}>{item.label}</span>
                <span className="tabular-nums font-medium">{item.value}</span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-aeblack-50">
                <div
                  className="h-full rounded-e-[4px] rounded-s-full transition-[width] duration-500"
                  style={{ width: `${(item.value / max) * 100}%`, minWidth: item.value > 0 ? 6 : 0, background: color }}
                />
              </div>
            </Comp>
          </li>
        );
      })}
    </ul>
  );
};
