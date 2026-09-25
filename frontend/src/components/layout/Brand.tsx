import React from "react";
import { Link } from "react-router-dom";
import { cn } from "../../lib/cn";
import { usePrefs } from "../../lib/prefs";

/** Original LexIntel mark (scales of justice). Deliberately not a UAE state emblem or any official seal. */
export const BrandMark: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 64 64" className={cn("size-9", className)} aria-hidden>
    <rect width="64" height="64" rx="14" className="fill-primary-600" />
    <path
      d="M32 13v38M18 22h28M20 22l-8 15a8 8 0 0 0 16 0zM44 22l-8 15a8 8 0 0 0 16 0zM23 51h18"
      fill="none"
      stroke="#fff"
      strokeWidth="3.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const Brand: React.FC<{ to?: string; inverted?: boolean; compact?: boolean }> = ({ to = "/", inverted, compact }) => {
  const { t } = usePrefs();
  return (
    <Link to={to} className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2" aria-label="LexIntel">
      <BrandMark />
      {!compact && (
        <span className="leading-tight">
          <span className={cn("block font-heading text-lg font-bold", inverted ? "text-white" : "text-aeblack-900")}>
            LexIntel
          </span>
          <span className={cn("block text-[11px] tracking-wide", inverted ? "text-white/60" : "muted")}>
            {t("Court decision support", "دعم القرار القضائي")}
          </span>
        </span>
      )}
    </Link>
  );
};

export const FlagBar: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn("flag-bar h-1 w-full", className)} aria-hidden />
);
