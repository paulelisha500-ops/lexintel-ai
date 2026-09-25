import React, { useState } from "react";
import { toast } from "sonner";
import { Trash2, UserPlus, Users } from "lucide-react";
import { api, ApiError } from "../../../api/client";
import { useInvalidate } from "../../../api/hooks";
import type { CaseDetailResponse, Person } from "../../../api/types";
import { useAuth } from "../../../auth/AuthContext";
import { Alert, Avatar, Badge, Button, Card, EmptyState, Input, Select } from "../../../components/ui/core";
import { Modal, Segmented, useConfirm } from "../../../components/ui/overlay";
import { fmtDate } from "../../../lib/format";
import { HEARING_ROLES, label, options } from "../../../lib/labels";
import { usePrefs } from "../../../lib/prefs";
import { can } from "../../../lib/roles";

export const PartiesTab: React.FC<{ c: CaseDetailResponse }> = ({ c }) => {
  const { t, lang } = usePrefs();
  const { user } = useAuth();
  const invalidate = useInvalidate();
  const { confirm, element } = useConfirm();
  const [open, setOpen] = useState(false);

  const remove = async (p: Person) => {
    const ok = await confirm({
      title: t("Remove party?", "إزالة الطرف؟"),
      body: t(`${p.full_name} will be removed from this case. Their record and statements are kept.`, `ستتم إزالة ${p.full_name} من هذه القضية مع الاحتفاظ بسجله وإفاداته.`),
      confirmLabel: t("Remove", "إزالة"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/cases/${c.id}/parties/${p.id}`);
      await invalidate(["case", c.id]);
      toast.success(t("Party removed", "تمت إزالة الطرف"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <Card
      title={t("Parties to the case", "أطراف القضية")}
      subtitle={t("Emirates ID numbers are stored only as a secure fingerprint.", "تُحفظ أرقام الهوية الإماراتية كبصمة آمنة فقط.")}
      actions={can.editCase(user?.role) && <Button icon={<UserPlus className="size-4" />} onClick={() => setOpen(true)}>{t("Add party", "إضافة طرف")}</Button>}
      padded={false}
    >
      {c.parties.length === 0 ? (
        <EmptyState icon={<Users className="size-7" />} title={t("No parties yet", "لا يوجد أطراف بعد")} description={t("Add the people involved: plaintiff, defendant, witnesses…", "أضف الأشخاص المعنيين: المدعي والمدعى عليه والشهود…")} />
      ) : (
        <ul className="divide-y divide-aeblack-50">
          {c.parties.map(({ person, role, added_at }) => (
            <li key={person.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
              <Avatar name={person.full_name} size="base" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{person.full_name}</div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs muted">
                  {person.emirates_id_last4 && <span>{t("Emirates ID", "الهوية")} •••• {person.emirates_id_last4}</span>}
                  {person.contact_phone && <span dir="ltr">{person.contact_phone}</span>}
                  <span>{person.preferred_language === "ar" ? "العربية" : "English"}</span>
                  {added_at && <span>{t("Added", "أضيف")} {fmtDate(added_at, lang)}</span>}
                </div>
              </div>
              <Badge tone="info">{label.hearingRole(role, lang)}</Badge>
              {can.createCase(user?.role) && (
                <Button variant="ghost" size="xs" iconOnly aria-label={t("Remove", "إزالة")} onClick={() => remove(person)}>
                  <Trash2 className="size-4 text-aered-600" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <AddPartyModal open={open} onClose={() => setOpen(false)} caseId={c.id} />
      {element}
    </Card>
  );
};

export const AddPartyModal: React.FC<{ open: boolean; onClose: () => void; caseId: string }> = ({ open, onClose, caseId }) => {
  const { t, lang } = usePrefs();
  const invalidate = useInvalidate();
  const [mode, setMode] = useState("new");
  const [role, setRole] = useState("witness");
  const [form, setForm] = useState({ full_name: "", emirates_id: "", contact_phone: "", preferred_language: lang });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [picked, setPicked] = useState<Person | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (mode !== "existing" || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const id = setTimeout(() => {
      api.get<Person[]>(`/people?q=${encodeURIComponent(query.trim())}`).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(id);
  }, [query, mode]);

  const save = async () => {
    setError(null);
    if (mode === "new" && form.full_name.trim().length < 2) {
      setError(t("Enter the person's full name.", "أدخل الاسم الكامل."));
      return;
    }
    if (mode === "existing" && !picked) {
      setError(t("Choose a person from the search results.", "اختر شخصاً من نتائج البحث."));
      return;
    }
    setSaving(true);
    try {
      await api.post(`/cases/${caseId}/parties`, mode === "new"
        ? { role, new_person: { ...form, emirates_id: form.emirates_id.trim() || null, contact_phone: form.contact_phone.trim() || null } }
        : { role, person_id: picked!.id }, { retry: false });
      await invalidate(["case", caseId]);
      toast.success(t("Party added", "تمت إضافة الطرف"));
      setForm({ full_name: "", emirates_id: "", contact_phone: "", preferred_language: lang });
      setPicked(null);
      setQuery("");
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={t("Add a party", "إضافة طرف")}
      footer={<><Button variant="outline" onClick={onClose}>{t("Cancel", "إلغاء")}</Button><Button loading={saving} onClick={save}>{t("Add", "إضافة")}</Button></>}>
      <div className="space-y-5">
        <Segmented value={mode} onChange={setMode} options={[{ value: "new", label: t("New person", "شخص جديد") }, { value: "existing", label: t("Existing person", "شخص مسجّل") }]} />
        <Select label={t("Role in this case", "الصفة في القضية")} value={role} onChange={(e) => setRole(e.target.value)} options={options(HEARING_ROLES, lang)} />
        {mode === "new" ? (
          <>
            <Input label={t("Full name", "الاسم الكامل")} required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            <div className="grid gap-5 sm:grid-cols-2">
              <Input label={t("Emirates ID (optional)", "رقم الهوية (اختياري)")} placeholder="784-XXXX-XXXXXXX-X" dir="ltr" value={form.emirates_id} onChange={(e) => setForm({ ...form, emirates_id: e.target.value })}
                hint={t("Stored as a secure fingerprint; only the last 4 digits are shown.", "يُحفظ كبصمة آمنة ويظهر آخر 4 أرقام فقط.")} />
              <Input label={t("Phone (optional)", "الهاتف (اختياري)")} dir="ltr" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
            </div>
            <Select label={t("Preferred language", "اللغة المفضلة")} value={form.preferred_language} onChange={(e) => setForm({ ...form, preferred_language: e.target.value as "ar" | "en" })}
              options={[{ value: "ar", label: "العربية" }, { value: "en", label: "English" }]} />
          </>
        ) : (
          <div>
            <Input label={t("Search by name", "ابحث بالاسم")} value={query} onChange={(e) => { setQuery(e.target.value); setPicked(null); }} />
            <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto">
              {results.map((p) => (
                <li key={p.id}>
                  <button onClick={() => setPicked(p)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start ${picked?.id === p.id ? "bg-primary-50 ring-1 ring-primary-600" : "hover:bg-aeblack-50"}`}>
                    <Avatar name={p.full_name} size="xs" />
                    <span className="flex-1 text-sm">{p.full_name}</span>
                    {p.emirates_id_last4 && <span className="text-xs muted">•••• {p.emirates_id_last4}</span>}
                  </button>
                </li>
              ))}
              {query.trim().length >= 2 && !results.length && <li className="px-3 py-2 text-sm muted">{t("No matches.", "لا توجد نتائج.")}</li>}
            </ul>
          </div>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
};
