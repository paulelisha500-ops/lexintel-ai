import React from "react";
import { AlertTriangle, ArrowDown, Minus, ArrowUp } from "lucide-react";
import type { Priority } from "../../api/types";
import { Badge } from "../../components/ui/core";
import { label } from "../../lib/labels";
import { usePrefs } from "../../lib/prefs";

export const PriorityBadge: React.FC<{ priority: Priority | null | undefined }> = ({ priority }) => {
  const { lang } = usePrefs();
  if (!priority) return <Badge tone="neutral">{label.priority("unscored", lang)}</Badge>;
  const icon = priority.level === "high" ? <ArrowUp className="size-3" /> : priority.level === "medium" ? <Minus className="size-3" /> : <ArrowDown className="size-3" />;
  return (
    <Badge tone={priority.level === "high" ? "error" : priority.level === "medium" ? "warning" : "neutral"} icon={icon}>
      {label.priority(priority.level, lang)}
      {priority.requires_human_review && <AlertTriangle className="size-3" aria-label="needs review" />}
    </Badge>
  );
};

const STATUS_TONE: Record<string, "info" | "warning" | "success" | "neutral" | "error"> = {
  intake: "neutral",
  under_investigation: "info",
  ready_for_hearing: "info",
  in_hearing: "warning",
  awaiting_ruling: "warning",
  resolved: "success",
  closed: "neutral",
};

export const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const { lang } = usePrefs();
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{label.caseStatus(status, lang)}</Badge>;
};

export const ProcessingBadge: React.FC<{ status: string }> = ({ status }) => {
  const { lang } = usePrefs();
  const tone =
    status === "done" || status === "indexed" || status === "reviewed"
      ? "success"
      : status === "failed" || status === "flagged"
        ? "error"
        : status === "skipped" || status === "pending_review"
          ? "neutral"
          : "warning";
  return <Badge tone={tone}>{label.processing(status, lang)}</Badge>;
};
