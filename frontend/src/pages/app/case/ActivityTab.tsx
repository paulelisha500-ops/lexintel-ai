import React from "react";
import { useCaseAudit } from "../../../api/hooks";
import type { CaseDetailResponse } from "../../../api/types";
import { Card, EmptyState, ErrorState, Skeleton } from "../../../components/ui/core";
import { fmtDateTime } from "../../../lib/format";
import { label } from "../../../lib/labels";
import { usePrefs } from "../../../lib/prefs";
import { describeAction } from "../admin/Audit";

export const ActivityTab: React.FC<{ c: CaseDetailResponse }> = ({ c }) => {
  const { t, lang } = usePrefs();
  const audit = useCaseAudit(c.id);
  return (
    <Card title={t("Activity on this case", "النشاط على هذه القضية")} subtitle={t("Every change, from every account, in order.", "كل تغيير، من كل حساب، بالترتيب.")}>
      {audit.isLoading ? <Skeleton className="h-40" /> : audit.isError ? <ErrorState error={audit.error} onRetry={() => audit.refetch()} /> : !audit.data?.items.length ? (
        <EmptyState title={t("No activity recorded", "لا يوجد نشاط مسجل")} />
      ) : (
        <ol className="relative space-y-5 border-s border-aeblack-100 ps-5">
          {audit.data.items.map((a) => (
            <li key={a.id} className="relative">
              <span className="absolute -start-[25px] top-1.5 size-2.5 rounded-full bg-primary-600" />
              <div className="text-sm font-medium">{describeAction(a, t)}</div>
              <div className="text-xs muted">
                {fmtDateTime(a.at, lang)} · {a.username ?? t("public", "العموم")}{a.role ? ` (${label.systemRole(a.role, lang)})` : ""}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
};
