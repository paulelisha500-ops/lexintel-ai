/** Arabic wording for server messages (ported from backend/app/core/messages.py). */

const ARABIC: Record<string, string> = {
  "Incorrect username or password.": "اسم المستخدم أو كلمة المرور غير صحيحة.",
  "This account has been disabled.": "تم تعطيل هذا الحساب.",
  "Your session has expired. Please sign in again.": "انتهت صلاحية جلستك. يرجى تسجيل الدخول مرة أخرى.",
  "Your current password is incorrect.": "كلمة المرور الحالية غير صحيحة.",
  "That username is already taken.": "اسم المستخدم مستخدم بالفعل.",
  "User not found.": "المستخدم غير موجود.",
  "You can't disable your own account or remove your own admin role.": "لا يمكنك تعطيل حسابك أو إزالة صلاحية المسؤول عن نفسك.",
  "At least one active administrator must remain.": "يجب أن يبقى مسؤول نظام نشط واحد على الأقل.",
  "Unknown role.": "دور غير معروف.",
  "Forbidden.": "هذا الإجراء غير مصرّح به.",
  "Not authenticated": "يلزم تسجيل الدخول.",
  "Not Found": "الصفحة غير موجودة.",
  "Method Not Allowed": "هذه الطريقة غير مسموح بها.",
  "Internal Server Error": "حدث خطأ في الخادم.",
  "Case not found.": "القضية غير موجودة.",
  "A case with that case number already exists.": "توجد قضية بهذا الرقم بالفعل.",
  "The assigned judge must be an active judge account.": "يجب أن يكون القاضي المكلَّف حساب قاضٍ نشطاً.",
  "Judges can update a case's status; other case details are edited by case staff.": "يمكن للقضاة تحديث حالة القضية، أما بقية تفاصيلها فيحرّرها موظفو القضية.",
  "Party not found on this case.": "الطرف غير موجود في هذه القضية.",
  "Person not found.": "الشخص غير موجود.",
  "Provide either person_id or new_person.": "أدخل إما person_id أو new_person.",
  "Choose a party or enter the person's details.": "اختر أحد الأطراف أو أدخل بيانات الشخص.",
  "Emirates ID must look like 784-YYYY-NNNNNNN-N.": "يجب أن تكون صيغة رقم الهوية الإماراتية 784-YYYY-NNNNNNN-N.",
  "Timeline event not found.": "حدث الجدول الزمني غير موجود.",
  "Complaint not found.": "الشكوى غير موجودة.",
  "A case has already been opened for this complaint.": "سبق فتح قضية لهذه الشكوى.",
  "Use 'Open case' to move a complaint to case_opened.": "استخدم «فتح قضية» لتحويل الشكوى إلى قضية.",
  "No complaint matches that reference number and tracking code.": "لا توجد شكوى مطابقة للرقم المرجعي ورمز المتابعة.",
  "Too many complaints from this connection. Please try again later.": "عدد كبير من الشكاوى من هذا الاتصال. يرجى المحاولة لاحقاً.",
  "Too many lookups. Please wait a few minutes.": "عدد كبير من عمليات الاستعلام. يرجى الانتظار بضع دقائق.",
  "Evidence not found.": "الدليل غير موجود.",
  "Evidence not found on this case.": "الدليل غير موجود في هذه القضية.",
  "File not found.": "الملف غير موجود.",
  "The uploaded file is empty.": "الملف المرفوع فارغ.",
  "The stored file is missing. This has been recorded in the audit log.": "الملف المحفوظ مفقود، وقد سُجّل ذلك في سجل التدقيق.",
  "Signature checks work on scanned documents (images or PDF).": "يعمل فحص التوقيع على المستندات الممسوحة ضوئياً (صور أو ملفات PDF).",
  "Both sources need extracted text to compare. Wait for processing to finish.": "تحتاج المقارنة إلى نص مستخرج من كلا المصدرين. انتظر انتهاء المعالجة.",
  "Sources must look like 'evidence:<id>' or 'statement:<id>'.": "يجب أن تكون المصادر بصيغة 'evidence:<id>' أو 'statement:<id>'.",
  "Hearing not found.": "الجلسة غير موجودة.",
  "This hearing was cancelled.": "أُلغيت هذه الجلسة.",
  "Session not found.": "جلسة القاعة غير موجودة.",
  "This session has been closed.": "أُغلقت هذه الجلسة.",
  "Statement not found.": "الإفادة غير موجودة.",
  "Statement not found on this case.": "الإفادة غير موجودة في هذه القضية.",
  "No recording is stored for this statement.": "لا يوجد تسجيل محفوظ لهذه الإفادة.",
  "No one is currently at the stand in this session.": "لا يوجد أحد في منصة الشهادة في هذه الجلسة حالياً.",
  "Step the current person down before closing the session.": "أنزِل الشخص الحالي من المنصة قبل إغلاق الجلسة.",
  "The active statement record was missing; the stand has been cleared.": "سجل الإفادة النشط مفقود، وقد أُخليت المنصة.",
  "The presiding judge must be an active judge account.": "يجب أن يكون قاضي الجلسة حساب قاضٍ نشطاً.",
  "Statements are temporarily unavailable.": "الإفادات غير متاحة مؤقتاً.",
  "Statements are temporarily unavailable (MongoDB is not reachable).": "الإفادات غير متاحة مؤقتاً (تعذّر الوصول إلى MongoDB).",
  "The courtroom record store (MongoDB) is temporarily unavailable. Please retry in a moment.": "مخزن سجلات قاعة المحكمة (MongoDB) غير متاح مؤقتاً. يرجى إعادة المحاولة بعد قليل.",
  "Law document not found.": "الوثيقة القانونية غير موجودة.",
  "This document is being indexed right now. Try again when it finishes.": "تجري فهرسة هذه الوثيقة الآن. حاول مرة أخرى بعد انتهائها.",
  "'In force until' can't be earlier than 'in force from'.": "لا يمكن أن يكون تاريخ «نافذ حتى» أسبق من تاريخ «نافذ من».",
  "Source URL must start with http:// or https://": "يجب أن يبدأ رابط المصدر بـ http:// أو https://",
  "Research limit reached for this hour. Please try again later.": "تم بلوغ حد البحث لهذه الساعة. يرجى المحاولة لاحقاً.",
  "Unknown action.": "إجراء غير معروف.",
  "The database is temporarily unavailable. Please retry in a moment.": "قاعدة البيانات غير متاحة مؤقتاً. يرجى إعادة المحاولة بعد قليل.",
  "A database error occurred. The request was not saved.": "حدث خطأ في قاعدة البيانات، ولم يُحفظ الطلب.",
  "Something went wrong on our side. The error has been logged.": "حدث خطأ لدينا، وقد سُجّل الخطأ.",
  "Invalid request.": "طلب غير صالح.",
  "The text contains a character that can't be stored.": "يحتوي النص على رمز لا يمكن حفظه.",
  "Please describe what happened in at least 20 characters.": "يرجى وصف ما حدث بما لا يقل عن 20 حرفاً.",
  "Enter a valid email address.": "أدخل عنوان بريد إلكتروني صحيحاً.",
  "Enter a valid phone number.": "أدخل رقم هاتف صحيحاً.",
  "Field required": "هذا الحقل مطلوب.",
  "The deadline must be a date between 2000 and 2100.": "يجب أن يكون الموعد النهائي تاريخاً بين عام 2000 و2100."
};

const TEMPLATES: [RegExp, string][] = [
  [new RegExp("^Too many failed sign-in attempts\\. Try again in (\\d+) minutes\\.$"), "عدد كبير من محاولات الدخول الفاشلة. حاول مرة أخرى بعد {0} دقيقة."],
  [new RegExp("^Password must contain at least (\\d+) characters and both letters and numbers\\.$"), "يجب أن تحتوي كلمة المرور على {0} أحرف على الأقل وعلى حروف وأرقام معاً."],
  [new RegExp("^Password must contain at least (\\d+) characters\\.$"), "يجب أن تحتوي كلمة المرور على {0} أحرف على الأقل."],
  [new RegExp("^Password must contain both letters and numbers\\.$"), "يجب أن تحتوي كلمة المرور على حروف وأرقام معاً."],
  [new RegExp("^This action requires one of these roles: (.+)\\.$"), "يتطلب هذا الإجراء أحد هذه الأدوار: {0}."],
  [new RegExp("^File is larger than the (\\d+) MB limit\\.$"), "حجم الملف يتجاوز الحد المسموح ({0} ميغابايت)."],
  [new RegExp("^File type '\\.(.*)' is not accepted here\\. Allowed: (.+)\\.$"), "نوع الملف '.{0}' غير مقبول هنا. الأنواع المسموح بها: {1}."],
  [new RegExp("^This exact file is already in the library as '(.+)'\\.$"), "هذا الملف موجود في المكتبة بالفعل باسم '{0}'."],
  [new RegExp("^Couldn't read that document \\((.+)\\)\\.$"), "تعذّرت قراءة هذه الوثيقة ({0})."],
  [new RegExp("^The document image couldn't be analysed \\((.+)\\)\\.$"), "تعذّر تحليل صورة الوثيقة ({0})."],
  [new RegExp("^The image couldn't be analysed \\((.+)\\)\\.$"), "تعذّر تحليل الصورة ({0})."],
  [new RegExp("^(.+) is still at the stand\\. Step them down first\\.$"), "{0} لا يزال في منصة الشهادة. أنزِله من المنصة أولاً."],
  [new RegExp("^The writing model could not be loaded: (.*)$"), "تعذّر تحميل نموذج الكتابة: {0}"],
  [new RegExp("^The writing model could not be unloaded: (.*)$"), "تعذّر إلغاء تحميل نموذج الكتابة: {0}"],
  [new RegExp("^(.+) not found\\.$"), "{0} غير موجود."],
];

export function translate(detail: unknown, lang: string): unknown {
  if (lang !== "ar" || typeof detail !== "string") return detail;
  if (ARABIC[detail]) return ARABIC[detail];
  for (const [pattern, arabic] of TEMPLATES) {
    const m = detail.match(pattern);
    if (m) return arabic.replace(/\{(\d+)\}/g, (_, i) => m[Number(i) + 1] ?? "");
  }
  return detail;
}

export function languageOf(header: string | null): "ar" | "en" {
  return (header ?? "").split(",")[0].trim().toLowerCase().startsWith("ar") ? "ar" : "en";
}
