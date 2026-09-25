import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3, BookOpen, CalendarDays, ChevronDown, FolderKanban, Inbox, KeyRound, Languages, LayoutDashboard, Library,
  LogOut, Menu as MenuIcon, Mic, ScrollText, Search, ServerCog, Users, X,
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { can } from "../../lib/roles";
import { cn } from "../../lib/cn";
import { label } from "../../lib/labels";
import { usePrefs } from "../../lib/prefs";
import { Avatar } from "../ui/core";
import { Menu } from "../ui/overlay";
import { Brand, FlagBar } from "./Brand";
import { CommandSearch } from "./CommandSearch";
import { LanguageSwitch, ThemeSwitch } from "./Switches";

interface NavEntry {
  to: string;
  label: string;
  icon: React.ReactNode;
  show: boolean;
  end?: boolean;
}

export const AppLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const { t, lang, toggleLang } = usePrefs();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const role = user?.role;

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sections: { title: string; items: NavEntry[] }[] = [
    {
      title: t("Workspace", "مساحة العمل"),
      items: [
        { to: "/app", label: t("Dashboard", "لوحة المتابعة"), icon: <LayoutDashboard />, show: true, end: true },
        { to: "/app/cases", label: t("Cases", "القضايا"), icon: <FolderKanban />, show: true },
        { to: "/app/complaints", label: t("Complaints", "الشكاوى"), icon: <Inbox />, show: can.triageComplaints(role) },
        { to: "/app/hearings", label: t("Hearings", "الجلسات"), icon: <CalendarDays />, show: true },
        { to: "/app/courtroom", label: t("Courtroom stand", "منصة الشهادة"), icon: <Mic />, show: can.runStand(role) },
      ],
    },
    {
      title: t("Law", "القانون"),
      items: [
        { to: "/app/research", label: t("Legal research", "البحث القانوني"), icon: <BookOpen />, show: true },
        { to: "/app/library", label: t("Law library", "المكتبة القانونية"), icon: <Library />, show: true },
        { to: "/app/analytics", label: t("Analytics", "التحليلات"), icon: <BarChart3 />, show: true },
      ],
    },
    {
      title: t("Administration", "الإدارة"),
      items: [
        { to: "/app/admin/users", label: t("Users", "المستخدمون"), icon: <Users />, show: can.admin(role) },
        { to: "/app/admin/audit", label: t("Audit log", "سجل التدقيق"), icon: <ScrollText />, show: can.admin(role) },
        { to: "/app/admin/system", label: t("System status", "حالة النظام"), icon: <ServerCog />, show: can.admin(role) },
      ],
    },
  ];

  const nav = (
    <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-5 scrollbar-thin" aria-label={t("Workspace", "مساحة العمل")}>
      {sections.map((section) => {
        const items = section.items.filter((i) => i.show);
        if (!items.length) return null;
        return (
          <div key={section.title}>
            <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">{section.title}</div>
            <ul className="space-y-0.5">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition [&_svg]:size-[18px]",
                        isActive
                          ? "bg-primary-600 text-white shadow-sm"
                          : "text-white/70 hover:bg-white/8 hover:text-white"
                      )
                    }
                  >
                    {item.icon}
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  const sidebar = (
    <div className="flex h-full flex-col bg-night-950 text-white">
      <div className="flex h-16 items-center px-5">
        <Brand to="/app" inverted />
      </div>
      <FlagBar className="opacity-80" />
      {nav}
      <div className="border-t border-white/10 p-4 text-[11px] leading-relaxed text-white/45">
        {t("AI output is decision support only. Every ruling is entered by a judge.", "مخرجات الذكاء الاصطناعي لدعم القرار فقط. كل حكم يُدخله قاضٍ.")}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <a href="#app-main" className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 aegov-btn btn-sm">
        {t("Skip to content", "تخطَّ إلى المحتوى")}
      </a>

      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 lg:block no-print">{sidebar}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-night-950/60" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 start-0 w-72 animate-fade-in">
            {sidebar}
            <button
              className="absolute end-3 top-4 grid size-9 place-items-center rounded-lg text-white hover:bg-white/10"
              onClick={() => setMobileOpen(false)}
              aria-label={t("Close menu", "إغلاق القائمة")}
            >
              <X className="size-5" />
            </button>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-aeblack-100 bg-whitely-50/90 px-4 backdrop-blur sm:px-6 no-print">
          <button
            className="grid size-9 place-items-center rounded-lg lg:hidden hover:bg-aeblack-50"
            onClick={() => setMobileOpen(true)}
            aria-label={t("Open menu", "فتح القائمة")}
          >
            <MenuIcon className="size-5" />
          </button>

          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-10 min-w-0 flex-1 max-w-md items-center gap-2 rounded-xl border border-aeblack-100 bg-whitely-100 px-3 text-sm muted transition hover:border-primary-300"
          >
            <Search className="size-4" aria-hidden />
            <span className="flex-1 truncate text-start">{t("Search cases, people, evidence, law…", "ابحث في القضايا والأشخاص والأدلة والقوانين…")}</span>
            <kbd className="hidden rounded border border-aeblack-200 px-1.5 text-[10px] sm:inline">Ctrl K</kbd>
          </button>

          <div className="ms-auto flex shrink-0 items-center gap-1">
            <LanguageSwitch className="hidden md:inline-flex" />
            <ThemeSwitch />
            {user && (
              <Menu
                trigger={
                  <button className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-aeblack-50">
                    <Avatar name={user.fullName} size="sm" />
                    <span className="hidden text-start leading-tight sm:block">
                      <span className="block max-w-40 truncate text-sm font-medium">{user.fullName}</span>
                      <span className="block text-xs muted">{label.systemRole(user.role, lang)}</span>
                    </span>
                    <ChevronDown className="size-4 muted" aria-hidden />
                  </button>
                }
                items={[
                  { label: t("Change password", "تغيير كلمة المرور"), icon: <KeyRound className="size-4" />, onSelect: () => navigate("/app/profile") },
                  { label: lang === "ar" ? "English" : "العربية", icon: <Languages className="size-4" />, onSelect: toggleLang },
                  "separator",
                  { label: t("Sign out", "تسجيل الخروج"), icon: <LogOut className="size-4" />, danger: true, onSelect: () => { logout(); navigate("/login"); } },
                ]}
              />
            )}
          </div>
        </header>

        <main id="app-main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>

      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
};
