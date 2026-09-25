import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { setApiLanguage } from "../api/client";

export type Lang = "en" | "ar";
export type Theme = "light" | "dark";

interface Prefs {
  lang: Lang;
  theme: Theme;
}

interface PrefsContextValue extends Prefs {
  dir: "ltr" | "rtl";
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  /** Bilingual string: t("Cases", "القضايا"). */
  t: (en: string, ar: string) => string;
}

const STORAGE_KEY = "lexintel.prefs";

function readPrefs(): Prefs {
  let stored: Partial<Prefs> = {};
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    stored = {};
  }
  const prefersDark = typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  return {
    lang: stored.lang === "ar" ? "ar" : "en",
    theme: stored.theme === "dark" || stored.theme === "light" ? stored.theme : prefersDark ? "dark" : "light",
  };
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

export const PrefsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);

  useEffect(() => {
    // Errors are worded by the server, so it needs to know the language too.
    setApiLanguage(prefs.lang);
    const root = document.documentElement;
    root.lang = prefs.lang;
    root.dir = prefs.lang === "ar" ? "rtl" : "ltr";
    root.classList.toggle("dark", prefs.theme === "dark");
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* private mode: preferences just won't persist */
    }
  }, [prefs]);

  const setLang = useCallback((lang: Lang) => setPrefs((p) => ({ ...p, lang })), []);
  const setTheme = useCallback((theme: Theme) => setPrefs((p) => ({ ...p, theme })), []);

  const value = useMemo<PrefsContextValue>(
    () => ({
      ...prefs,
      dir: prefs.lang === "ar" ? "rtl" : "ltr",
      setLang,
      setTheme,
      toggleLang: () => setLang(prefs.lang === "ar" ? "en" : "ar"),
      toggleTheme: () => setTheme(prefs.theme === "dark" ? "light" : "dark"),
      t: (en: string, ar: string) => (prefs.lang === "ar" ? ar : en),
    }),
    [prefs, setLang, setTheme]
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
};

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used inside <PrefsProvider>");
  return ctx;
}
