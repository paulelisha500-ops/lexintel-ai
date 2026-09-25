import React, { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, LogIn, ShieldCheck } from "lucide-react";
import { ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { Alert, Button, Input } from "../../components/ui/core";
import { BrandMark } from "../../components/layout/Brand";
import { usePrefs } from "../../lib/prefs";

export default function Login() {
  const { t } = usePrefs();
  const { user, login, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/app";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to={from} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setLoading(true);
    setError(null);
    try {
      await login(username, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Sign-in failed. Please try again.", "تعذّر تسجيل الدخول. حاول مرة أخرى."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-[calc(100vh-4.25rem)] lg:grid-cols-2">
      <div className="relative hidden overflow-hidden lg:block">
        <img src="/images/abu-dhabi-towers.jpg" alt={t("Abu Dhabi towers at sunset", "أبراج أبوظبي عند الغروب")} className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-night-950/90 via-night-950/30 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-12 text-white">
          <ShieldCheck className="size-8 text-gold-300" aria-hidden />
          <h2 className="mt-4 font-heading text-3xl font-bold">{t("Secure staff workspace", "مساحة عمل آمنة للموظفين")}</h2>
          <p className="mt-2 max-w-md text-white/80">
            {t("Every action is recorded in the audit log. Sessions end when you close the browser tab.",
              "تُسجَّل كل الإجراءات في سجل التدقيق، وتنتهي الجلسة عند إغلاق تبويب المتصفح.")}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-md">
          <BrandMark className="size-12" />
          <h1 className="mt-6 font-heading text-3xl font-bold">{t("Staff sign in", "دخول الموظفين")}</h1>
          <p className="mt-2 muted">
            {t("For judges, prosecutors, clerks, case officers and administrators.", "للقضاة ووكلاء النيابة وكتّاب المحاكم ومسؤولي القضايا ومسؤولي النظام.")}
          </p>

          {sessionExpired && (
            <Alert tone="warning" size="sm" className="mt-6">
              {t("Your session ended. Please sign in again.", "انتهت جلستك. يرجى تسجيل الدخول مرة أخرى.")}
            </Alert>
          )}

          <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
            <Input
              label={t("Username", "اسم المستخدم")}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              dir="ltr"
              required
            />
            <Input
              label={t("Password", "كلمة المرور")}
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              dir="ltr"
              required
              suffix={
                <button type="button" onClick={() => setShow((s) => !s)} className="grid h-full min-h-10 min-w-10 place-items-center px-3" aria-label={show ? t("Hide password", "إخفاء كلمة المرور") : t("Show password", "إظهار كلمة المرور")}>
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              }
            />
            {error && <Alert tone="error" size="sm">{error}</Alert>}
            <Button type="submit" size="base" block loading={loading} disabled={!username || !password} icon={<LogIn className="size-4" />}>
              {t("Sign in", "تسجيل الدخول")}
            </Button>
          </form>

          <p className="mt-8 text-sm muted">
            {t("No self-registration. Accounts are created by a system administrator.", "لا يوجد تسجيل ذاتي، ويُنشئ الحسابات مسؤول النظام.")}
          </p>
        </div>
      </div>
    </div>
  );
}
