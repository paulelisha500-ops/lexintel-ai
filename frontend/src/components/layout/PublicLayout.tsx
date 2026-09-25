import React, { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { LogIn, Menu as MenuIcon, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { usePrefs } from "../../lib/prefs";
import { useAuth } from "../../auth/AuthContext";
import { Brand, FlagBar } from "./Brand";
import { LanguageSwitch, ThemeSwitch } from "./Switches";

export const PublicLayout: React.FC = () => {
  const { t } = usePrefs();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const links = [
    { to: "/", label: t("Home", "الرئيسية"), end: true },
    { to: "/complaints/new", label: t("File a complaint", "تقديم شكوى") },
    { to: "/complaints/track", label: t("Track a complaint", "متابعة شكوى") },
  ];

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "rounded-lg px-3 py-2 text-sm font-medium transition",
      isActive ? "text-primary-700" : "hover:text-primary-700"
    );

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 aegov-btn btn-sm">
        {t("Skip to content", "تخطَّ إلى المحتوى")}
      </a>
      <FlagBar />
      <header className="sticky top-0 z-40 border-b border-aeblack-100 bg-whitely-50/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Brand />
          <nav className="hidden items-center gap-1 md:flex" aria-label={t("Main", "رئيسي")}>
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            <LanguageSwitch className="hidden sm:inline-flex" />
            <ThemeSwitch />
            <Link to={user ? "/app" : "/login"} className="aegov-btn btn-sm hidden sm:inline-flex">
              <LogIn className="size-4" aria-hidden />
              {user ? t("Open workspace", "مساحة العمل") : t("Staff sign in", "دخول الموظفين")}
            </Link>
            <button
              className="grid size-9 place-items-center rounded-lg md:hidden hover:bg-aeblack-50"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={t("Menu", "القائمة")}
            >
              {open ? <X className="size-5" /> : <MenuIcon className="size-5" />}
            </button>
          </div>
        </div>
        {open && (
          <div className="border-t border-aeblack-100 px-4 py-3 md:hidden">
            <nav className="flex flex-col gap-1">
              {links.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end} className={linkClass} onClick={() => setOpen(false)}>
                  {l.label}
                </NavLink>
              ))}
              <Link to={user ? "/app" : "/login"} className="aegov-btn btn-sm mt-2" onClick={() => setOpen(false)}>
                {user ? t("Open workspace", "مساحة العمل") : t("Staff sign in", "دخول الموظفين")}
              </Link>
              <LanguageSwitch className="mt-1 self-start" />
            </nav>
          </div>
        )}
      </header>

      <main id="main" className="flex-1">
        <Outlet />
      </main>

      <footer className="bg-night-950 text-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-3">
          <div>
            <Brand inverted />
            <p className="mt-4 max-w-sm text-sm text-white/65">
              {t(
                "Decision support for courts, prosecutors and lawyers. Humans make every legal decision.",
                "منصة لدعم القرار للمحاكم والنيابة والمحامين. القرار القانوني دائماً للإنسان."
              )}
            </p>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gold-300">{t("For the public", "للجمهور")}</h2>
            <ul className="mt-3 space-y-2 text-sm text-white/75">
              <li><Link className="inline-block py-1.5 text-white/75 hover:text-white" to="/complaints/new">{t("File a complaint", "تقديم شكوى")}</Link></li>
              <li><Link className="inline-block py-1.5 text-white/75 hover:text-white" to="/complaints/track">{t("Track a complaint", "متابعة شكوى")}</Link></li>
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gold-300">{t("Important notice", "تنبيه مهم")}</h2>
            <p className="mt-3 text-sm text-white/65">
              {t(
                "LexIntel is an independent decision-support platform. It is not an official UAE government website and does not replace licensed legal counsel. In an emergency call 999.",
                "LexIntel منصة مستقلة لدعم القرار، وليست موقعاً حكومياً رسمياً، ولا تغني عن الاستشارة القانونية المرخّصة. في حالات الطوارئ اتصل على 999."
              )}
            </p>
          </div>
        </div>
        <div className="border-t border-white/10 py-4 text-center text-xs text-white/50">
          © {new Date().getFullYear()} LexIntel · {t("Photos: Unsplash (see credits)", "الصور: Unsplash (انظر المصادر)")}
        </div>
      </footer>
    </div>
  );
};
