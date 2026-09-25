import React, { useState } from "react";
import { toast } from "sonner";
import { KeyRound, MoreHorizontal, Pencil, UserCheck, UserPlus, UserX } from "lucide-react";
import { api, ApiError } from "../../../api/client";
import { useInvalidate, useUsers } from "../../../api/hooks";
import type { UserAccount } from "../../../api/types";
import { useAuth } from "../../../auth/AuthContext";
import { Alert, Avatar, Badge, Button, ErrorState, Input, Select } from "../../../components/ui/core";
import { DataTable, PageHeader, type Column } from "../../../components/ui/data";
import { Menu, Modal } from "../../../components/ui/overlay";
import { fmtAgo, fmtDate } from "../../../lib/format";
import { SYSTEM_ROLES, label, options } from "../../../lib/labels";
import { usePrefs } from "../../../lib/prefs";

export default function Users() {
  const { t, lang } = usePrefs();
  const { user: me } = useAuth();
  const users = useUsers();
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState<UserAccount | "new" | null>(null);
  const [resetting, setResetting] = useState<UserAccount | null>(null);

  const toggleActive = async (u: UserAccount) => {
    try {
      await api.patch(`/auth/users/${u.id}`, { is_active: !u.is_active });
      await invalidate(["admin", "users"]);
      toast.success(u.is_active ? t("Account disabled", "تم تعطيل الحساب") : t("Account enabled", "تم تفعيل الحساب"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    }
  };

  const columns: Column<UserAccount>[] = [
    { key: "name", header: t("Name", "الاسم"), sortValue: (u) => u.full_name, cell: (u) => (
      <div className="flex items-center gap-3">
        <Avatar name={u.full_name} />
        <div>
          <div className="font-medium">{u.full_name}{u.id === me?.id && <span className="ms-2 text-xs muted">({t("you", "أنت")})</span>}</div>
          <div className="text-xs muted" dir="ltr">{u.username}</div>
        </div>
      </div>
    ) },
    { key: "role", header: t("Role", "الدور"), sortValue: (u) => u.role, cell: (u) => <Badge tone={u.role === "admin" ? "gold" : u.role === "judge" ? "info" : "neutral"}>{label.systemRole(u.role, lang)}</Badge> },
    { key: "status", header: t("Status", "الحالة"), sortValue: (u) => (u.is_active ? 1 : 0), cell: (u) => <Badge tone={u.is_active ? "success" : "error"}>{u.is_active ? t("Active", "نشط") : t("Disabled", "معطّل")}</Badge> },
    { key: "login", header: t("Last sign-in", "آخر دخول"), hideOnMobile: true, sortValue: (u) => u.last_login_at ?? "", cell: (u) => (u.last_login_at ? fmtAgo(u.last_login_at, lang) : <span className="muted">{t("Never", "لم يسجل الدخول")}</span>) },
    { key: "created", header: t("Created", "أُنشئ"), hideOnMobile: true, cell: (u) => fmtDate(u.created_at, lang) },
    { key: "actions", header: "", cell: (u) => (
      <Menu trigger={<Button variant="ghost" size="xs" iconOnly aria-label={t("Actions", "إجراءات")}><MoreHorizontal className="size-4" /></Button>}
        items={[
          { label: t("Edit", "تعديل"), icon: <Pencil className="size-4" />, onSelect: () => setEditing(u) },
          { label: t("Reset password", "إعادة تعيين كلمة المرور"), icon: <KeyRound className="size-4" />, onSelect: () => setResetting(u) },
          { label: u.is_active ? t("Disable account", "تعطيل الحساب") : t("Enable account", "تفعيل الحساب"), icon: u.is_active ? <UserX className="size-4" /> : <UserCheck className="size-4" />, danger: u.is_active, disabled: u.id === me?.id, onSelect: () => toggleActive(u) },
        ]} />
    ) },
  ];

  return (
    <div>
      <PageHeader title={t("Users", "المستخدمون")} subtitle={t("Staff accounts. There is no self-registration.", "حسابات الموظفين، ولا يوجد تسجيل ذاتي.")}
        actions={<Button icon={<UserPlus className="size-4" />} onClick={() => setEditing("new")}>{t("New user", "مستخدم جديد")}</Button>} />
      <div className="surface overflow-hidden">
        {users.isError ? <div className="p-5"><ErrorState error={users.error} onRetry={() => users.refetch()} /></div> : (
          <DataTable columns={columns} rows={users.data} rowKey={(u) => u.id} loading={users.isLoading} initialSort={{ key: "name", dir: "asc" }} />
        )}
      </div>
      <UserModal target={editing} onClose={() => setEditing(null)} />
      <ResetModal target={resetting} onClose={() => setResetting(null)} />
    </div>
  );
}

const UserModal: React.FC<{ target: UserAccount | "new" | null; onClose: () => void }> = ({ target, onClose }) => {
  const { t, lang } = usePrefs();
  const invalidate = useInvalidate();
  const isNew = target === "new";
  const [form, setForm] = useState({ username: "", full_name: "", role: "clerk", password: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (!target) return;
    setError(null);
    setForm(target === "new" ? { username: "", full_name: "", role: "clerk", password: "" } : { username: target.username, full_name: target.full_name, role: target.role, password: "" });
  }, [target]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (isNew) await api.post("/auth/users", { ...form, username: form.username.trim().toLowerCase() }, { retry: false });
      else await api.patch(`/auth/users/${(target as UserAccount).id}`, { full_name: form.full_name, role: form.role }, { retry: false });
      await invalidate(["admin", "users"], ["judges"]);
      toast.success(isNew ? t("User created", "تم إنشاء المستخدم") : t("User updated", "تم تحديث المستخدم"));
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!target} onOpenChange={(o) => !o && onClose()} title={isNew ? t("New user", "مستخدم جديد") : t("Edit user", "تعديل المستخدم")}
      footer={<><Button variant="outline" onClick={onClose}>{t("Cancel", "إلغاء")}</Button><Button loading={saving} onClick={save}>{t("Save", "حفظ")}</Button></>}>
      <div className="grid gap-5">
        <Input label={t("Username", "اسم المستخدم")} dir="ltr" required disabled={!isNew} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} hint={isNew ? t("Letters, numbers, dots, dashes.", "حروف وأرقام ونقاط وشرطات.") : undefined} />
        <Input label={t("Full name", "الاسم الكامل")} required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        <Select label={t("Role", "الدور")} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} options={options(SYSTEM_ROLES, lang)} />
        {isNew && <Input label={t("Initial password", "كلمة المرور الأولية")} type="password" dir="ltr" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} hint={t("At least 10 characters with letters and numbers.", "10 أحرف على الأقل تتضمن حروفاً وأرقاماً.")} autoComplete="new-password" />}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
};

const ResetModal: React.FC<{ target: UserAccount | null; onClose: () => void }> = ({ target, onClose }) => {
  const { t } = usePrefs();
  const [pw, setPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  React.useEffect(() => { setPw(""); setError(null); }, [target]);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.post(`/auth/users/${target!.id}/reset-password`, { new_password: pw }, { retry: false });
      toast.success(t("Password reset. Existing sessions for this user are signed out.", "تمت إعادة تعيين كلمة المرور وتسجيل خروج الجلسات الحالية."));
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open={!!target} onOpenChange={(o) => !o && onClose()} title={t("Reset password", "إعادة تعيين كلمة المرور")} description={target?.full_name} size="sm"
      footer={<><Button variant="outline" onClick={onClose}>{t("Cancel", "إلغاء")}</Button><Button loading={saving} onClick={save}>{t("Reset", "إعادة التعيين")}</Button></>}>
      <div className="space-y-4">
        <Input label={t("New password", "كلمة المرور الجديدة")} type="password" dir="ltr" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" hint={t("At least 10 characters with letters and numbers.", "10 أحرف على الأقل تتضمن حروفاً وأرقاماً.")} />
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
};
