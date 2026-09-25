import React from "react";
import { Languages, Moon, Sun } from "lucide-react";
import { cn } from "../../lib/cn";
import { usePrefs } from "../../lib/prefs";
import { Tooltip } from "../ui/overlay";

export const LanguageSwitch: React.FC<{ className?: string; inverted?: boolean }> = ({ className, inverted }) => {
  const { lang, toggleLang } = usePrefs();
  return (
    <button
      onClick={toggleLang}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium transition",
        inverted ? "text-white/90 hover:bg-white/10" : "hover:bg-aeblack-50",
        className
      )}
      aria-label={lang === "ar" ? "Switch to English" : "التبديل إلى العربية"}
    >
      <Languages className="size-4" aria-hidden />
      <span className={lang === "ar" ? "font-inter" : "font-notokufi"}>{lang === "ar" ? "English" : "العربية"}</span>
    </button>
  );
};

export const ThemeSwitch: React.FC<{ className?: string; inverted?: boolean }> = ({ className, inverted }) => {
  const { theme, toggleTheme, t } = usePrefs();
  const label = theme === "dark" ? t("Light mode", "الوضع الفاتح") : t("Dark mode", "الوضع الداكن");
  return (
    <Tooltip content={label}>
      <button
        onClick={toggleTheme}
        className={cn(
          "grid size-9 place-items-center rounded-lg transition",
          inverted ? "text-white/90 hover:bg-white/10" : "hover:bg-aeblack-50",
          className
        )}
        aria-label={label}
      >
        {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
    </Tooltip>
  );
};
