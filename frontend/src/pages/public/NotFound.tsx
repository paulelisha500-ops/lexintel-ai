import React from "react";
import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { EmptyState } from "../../components/ui/core";
import { usePrefs } from "../../lib/prefs";

export default function NotFound({ inApp }: { inApp?: boolean }) {
  const { t } = usePrefs();
  return (
    <div className="py-16">
      <EmptyState
        icon={<Compass className="size-7" />}
        title={t("Page not found", "الصفحة غير موجودة")}
        description={t("The page you're looking for doesn't exist or has moved.", "الصفحة التي تبحث عنها غير موجودة أو تم نقلها.")}
        action={
          <Link to={inApp ? "/app" : "/"} className="aegov-btn btn-sm">
            {inApp ? t("Back to dashboard", "العودة إلى لوحة المتابعة") : t("Back to home", "العودة إلى الرئيسية")}
          </Link>
        }
      />
    </div>
  );
}
