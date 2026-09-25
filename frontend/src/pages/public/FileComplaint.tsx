import React, { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, Copy, Printer, ShieldAlert } from "lucide-react";
import { api, ApiError } from "../../api/client";
import { Alert, Button, Checkbox, Input, Textarea } from "../../components/ui/core";
import { Stepper } from "../../components/ui/data";
import { cn } from "../../lib/cn";
import { CASE_TYPES } from "../../lib/labels";
import { usePrefs } from "../../lib/prefs";

interface Submitted {
  reference_number: string;
  tracking_code: string;
  status_text: string;
  submitted_at: string;
}

const TYPE_HINTS: Record<string, [string, string]> = {
  criminal: ["Theft, assault, threats, violence", "سرقة، اعتداء، تهديد، عنف"],
  civil: ["Contracts, rent, salary, debts", "عقود، إيجار، رواتب، ديون"],
  cybercrime: ["Online fraud, hacking, blackmail", "احتيال إلكتروني، اختراق، ابتزاز"],
  traffic: ["Accidents, dangerous driving", "حوادث، قيادة خطرة"],
  grievance: ["A public service or government office", "خدمة عامة أو جهة حكومية"],
};

export default function FileComplaint() {
  const { t, lang } = usePrefs();
  const [step, setStep] = useState(0);
  const [caseType, setCaseType] = useState<string>("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Submitted | null>(null);

  const validateStep = (s: number): boolean => {
    const errs: Record<string, string> = {};
    if (s === 0 && !caseType) errs.caseType = t("Choose what the complaint is about.", "اختر موضوع الشكوى.");
    if (s === 1 && description.trim().length < 20)
      errs.description = t("Please describe what happened in at least 20 characters.", "يرجى وصف ما حدث بما لا يقل عن 20 حرفاً.");
    if (s === 2) {
      if (email && !/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(email)) errs.email = t("Enter a valid email address.", "أدخل بريداً إلكترونياً صحيحاً.");
      if (phone && !/^[+\d][\d\s\-()]{6,}$/.test(phone)) errs.phone = t("Enter a valid phone number.", "أدخل رقم هاتف صحيحاً.");
      if (!consent) errs.consent = t("Please confirm the declaration.", "يرجى تأكيد الإقرار.");
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => validateStep(step) && setStep((s) => s + 1);

  const submit = async () => {
    if (!validateStep(2)) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post<Submitted>("/complaints", {
        case_type: caseType,
        description: description.trim(),
        location: location.trim() || null,
        complainant_name: name.trim() || null,
        complainant_phone: phone.trim() || null,
        complainant_email: email.trim() || null,
        preferred_language: lang,
      }, { retry: false });
      setResult(res);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Couldn't submit. Please try again.", "تعذّر الإرسال. يرجى المحاولة مرة أخرى."));
    } finally {
      setSubmitting(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("Copied", "تم النسخ"));
    } catch {
      toast.error(t("Couldn't copy — please write it down.", "تعذّر النسخ — يرجى تدوينه."));
    }
  };

  if (result) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <div className="surface p-8 text-center animate-slide-up">
          <CheckCircle2 className="mx-auto size-14 text-aegreen-600" aria-hidden />
          <h1 className="mt-4 font-heading text-2xl font-bold">{t("Your complaint has been received", "تم استلام شكواك")}</h1>
          <p className="mt-2 muted">
            {t("Keep these details. You need both to check the status of your complaint.", "احتفظ بهذه البيانات، فستحتاج إليهما معاً لمتابعة حالة الشكوى.")}
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {[
              { label: t("Reference number", "الرقم المرجعي"), value: result.reference_number },
              { label: t("Tracking code", "رمز المتابعة"), value: result.tracking_code },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-primary-200 bg-primary-50 p-4">
                <div className="text-xs font-medium uppercase tracking-wide muted">{item.label}</div>
                <div className="mt-1 font-mono text-xl font-bold tracking-wider" dir="ltr">{item.value}</div>
                <button onClick={() => copy(item.value)} className="mt-2 inline-flex items-center gap-1 text-xs text-primary-700 hover:underline">
                  <Copy className="size-3.5" aria-hidden /> {t("Copy", "نسخ")}
                </button>
              </div>
            ))}
          </div>
          <Alert tone="info" className="mt-6 text-start" size="sm">
            {t(
              "The tracking code is shown only once and is not stored in readable form. If you lose it, you'll need to file a new complaint.",
              "يُعرض رمز المتابعة مرة واحدة فقط ولا يُحفظ بصيغة مقروءة. إن فقدته فستحتاج إلى تقديم شكوى جديدة."
            )}
          </Alert>
          <div className="mt-8 flex flex-wrap justify-center gap-3 no-print">
            <Link to={`/complaints/track?reference=${encodeURIComponent(result.reference_number)}`} className="aegov-btn btn-sm">
              {t("Track status", "متابعة الحالة")}
            </Link>
            <Button variant="outline" icon={<Printer className="size-4" />} onClick={() => window.print()}>
              {t("Print", "طباعة")}
            </Button>
            <Button
              variant="link"
              onClick={() => {
                setResult(null); setStep(0); setCaseType(""); setDescription(""); setLocation(""); setConsent(false);
              }}
            >
              {t("File another complaint", "تقديم شكوى أخرى")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const steps = [t("Type", "النوع"), t("Details", "التفاصيل"), t("Contact & submit", "التواصل والإرسال")];

  return (
    <div>
      <section className="relative isolate overflow-hidden bg-night-950">
        <img src="/images/signing.jpg" alt="" className="absolute inset-0 -z-10 size-full object-cover opacity-35" />
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
          <h1 className="font-heading text-3xl font-bold text-white sm:text-4xl">{t("File a complaint", "تقديم شكوى")}</h1>
          <p className="mt-2 text-white/80">
            {t("No account needed. It takes about three minutes.", "لا حاجة لحساب. تستغرق نحو ثلاث دقائق.")}
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Alert tone="warning" size="sm" className="mb-6" title={t("In an emergency, call 999", "في حالات الطوارئ اتصل على 999")}>
          {t("This form is not monitored in real time. LexIntel is not an official government service.",
            "لا تتم متابعة هذا النموذج بشكل فوري. LexIntel ليست خدمة حكومية رسمية.")}
        </Alert>

        <div className="surface p-6 sm:p-8">
          <Stepper steps={steps} current={step} />

          <div className="mt-8">
            {step === 0 && (
              <fieldset>
                <legend className="font-heading text-lg font-semibold">{t("What is your complaint about?", "ما موضوع شكواك؟")}</legend>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {Object.entries(CASE_TYPES).map(([value, pair]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setCaseType(value)}
                      aria-pressed={caseType === value}
                      className={cn(
                        "rounded-xl border-2 p-4 text-start transition",
                        caseType === value
                          ? "border-primary-600 bg-primary-50"
                          : "border-aeblack-100 hover:border-primary-300"
                      )}
                    >
                      <div className="font-semibold">{lang === "ar" ? pair[1] : pair[0]}</div>
                      <div className="mt-0.5 text-sm muted">{lang === "ar" ? TYPE_HINTS[value][1] : TYPE_HINTS[value][0]}</div>
                    </button>
                  ))}
                </div>
                {fieldErrors.caseType && <p className="mt-2 text-sm text-aered-600">{fieldErrors.caseType}</p>}
              </fieldset>
            )}

            {step === 1 && (
              <div className="space-y-5">
                <Textarea
                  label={t("What happened?", "ماذا حدث؟")}
                  required
                  rows={7}
                  value={description}
                  maxLength={8000}
                  onChange={(e) => setDescription(e.target.value)}
                  error={fieldErrors.description}
                  hint={t("Include when and where it happened, who was involved, and any amounts or reference numbers.",
                    "اذكر متى وأين حدث ذلك، ومن المعنيون، وأي مبالغ أو أرقام مرجعية.") + ` (${description.length}/8000)`}
                />
                <Input
                  label={t("Location (optional)", "الموقع (اختياري)")}
                  value={location}
                  maxLength={300}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder={t("e.g. Al Barsha, Dubai", "مثال: البرشاء، دبي")}
                />
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <p className="text-sm muted">
                  {t("Contact details are optional but help a case officer reach you.", "بيانات التواصل اختيارية، لكنها تساعد مسؤول القضية على التواصل معك.")}
                </p>
                <Input label={t("Full name", "الاسم الكامل")} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                <div className="grid gap-5 sm:grid-cols-2">
                  <Input label={t("Mobile number", "رقم الهاتف المتحرك")} value={phone} onChange={(e) => setPhone(e.target.value)} error={fieldErrors.phone} dir="ltr" autoComplete="tel" placeholder="+971 5X XXX XXXX" />
                  <Input label={t("Email", "البريد الإلكتروني")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldErrors.email} dir="ltr" autoComplete="email" />
                </div>
                <div>
                  <Checkbox
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    label={t("I confirm the information is true to the best of my knowledge.", "أقرّ بأن المعلومات صحيحة على حد علمي.")}
                    description={t("Knowingly filing a false report may be an offence.", "تقديم بلاغ كاذب عن علم قد يُعد مخالفة.")}
                  />
                  {fieldErrors.consent && <p className="mt-1 text-sm text-aered-600">{fieldErrors.consent}</p>}
                </div>
                <div className="rounded-xl bg-aeblack-50 p-4 text-sm">
                  <div className="font-semibold">{t("Summary", "ملخص")}</div>
                  <div className="mt-1 muted">
                    {lang === "ar" ? CASE_TYPES[caseType]?.[1] : CASE_TYPES[caseType]?.[0]} · {description.slice(0, 140)}
                    {description.length > 140 ? "…" : ""}
                  </div>
                </div>
                {error && <Alert tone="error">{error}</Alert>}
              </div>
            )}
          </div>

          <div className="mt-8 flex items-center justify-between gap-3 border-t border-aeblack-100 pt-6">
            <Button variant="outline" disabled={step === 0 || submitting} onClick={() => setStep((s) => s - 1)}>
              {t("Back", "رجوع")}
            </Button>
            {step < 2 ? (
              <Button onClick={next}>{t("Continue", "متابعة")}</Button>
            ) : (
              <Button loading={submitting} onClick={submit} icon={<ShieldAlert className="size-4" />}>
                {t("Submit complaint", "إرسال الشكوى")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
