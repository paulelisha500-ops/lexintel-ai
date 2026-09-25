import React, { useState } from "react";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { Alert, Button, Card, Input, KeyValue } from "../../components/ui/core";
import { PageHeader } from "../../components/ui/data";
import { LanguageSwitch, ThemeSwitch } from "../../components/layout/Switches";
import { label } from "../../lib/labels";
import { usePrefs } from "../../lib/prefs";

export default function Profile() {
  const { t, lang } = usePrefs();
  const { user, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirmPw) return setError(t("The new passwords don't match.", "كلمتا المرور الجديدتان غير متطابقتين."));
    setSaving(true);
    setError(null);
    try {
      await api.post("/auth/me/password", { current_password: current, new_password: next }, { retry: false });
      toast.success(t("Password changed. Please sign in again.", "تم تغيير كلمة المرور. يرجى تسجيل الدخول مجدداً."));
      logout();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title={t("Your account", "حسابك")} />
      <div className="space-y-6">
        <Card title={t("Profile", "الملف الشخصي")}>
          <KeyValue items={[
            { label: t("Name", "الاسم"), value: user?.fullName },
            { label: t("Username", "اسم المستخدم"), value: <span dir="ltr">{user?.username}</span> },
            { label: t("Role", "الدور"), value: label.systemRole(user?.role, lang) },
          ]} />
        </Card>
        <Card title={t("Display", "العرض")}>
          <div className="flex flex-wrap items-center gap-3">
            <LanguageSwitch className="border border-aeblack-100" />
            <ThemeSwitch className="border border-aeblack-100" />
          </div>
        </Card>
        <Card title={t("Change password", "تغيير كلمة المرور")} subtitle={t("All your other sessions will be signed out.", "سيتم تسجيل خروج جلساتك الأخرى.")}>
          <form onSubmit={submit} className="grid gap-5 sm:max-w-md">
            <Input label={t("Current password", "كلمة المرور الحالية")} type="password" dir="ltr" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            <Input label={t("New password", "كلمة المرور الجديدة")} type="password" dir="ltr" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required hint={t("At least 10 characters with letters and numbers.", "10 أحرف على الأقل تتضمن حروفاً وأرقاماً.")} />
            <Input label={t("Confirm new password", "تأكيد كلمة المرور الجديدة")} type="password" dir="ltr" autoComplete="new-password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} required />
            {error && <Alert tone="error">{error}</Alert>}
            <Button type="submit" loading={saving} icon={<KeyRound className="size-4" />} disabled={!current || !next}>{t("Change password", "تغيير كلمة المرور")}</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
