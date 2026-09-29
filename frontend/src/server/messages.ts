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

// ---------------------------------------------------------------------------
// Explanations that accompany results (draft status, research notes, disclaimers).
// Translated sentence by sentence, so a message built from several parts is covered.
// ---------------------------------------------------------------------------

const SENTENCES_AR: Record<string, string> = {
  "The writing model is busy with other drafts.": "نموذج الكتابة مشغول بمسودات أخرى.",
  "The draft drifted into another language, so it was withheld.": "انحرفت المسودة إلى لغة أخرى، لذا حُجبت.",
  "The draft was not written in Arabic, so it was withheld.": "لم تُكتب المسودة بالعربية، لذا حُجبت.",
  "The draft was not written in English, so it was withheld.": "لم تُكتب المسودة بالإنجليزية، لذا حُجبت.",
  "The writing model returned nothing.": "لم يُرجع نموذج الكتابة أي نص.",
  "The draft did not match the sources closely enough, so it was withheld.": "لم تطابق المسودة المصادر بدرجة كافية، لذا حُجبت.",
  "The writing model could not be loaded on this device.": "تعذّر تحميل نموذج الكتابة على هذا الجهاز.",
  "The writing model is not available right now.": "نموذج الكتابة غير متاح حالياً.",
  "This device does not have enough memory for the writing model.": "لا تتوفر على هذا الجهاز ذاكرة كافية لنموذج الكتابة.",
  "The quoted key facts above are unaffected.": "الوقائع الرئيسية المقتبسة أعلاه لم تتأثر.",
  "The draft could not be written just now.": "تعذّرت كتابة المسودة الآن.",
  "The file has too little text for a useful draft yet -- the key facts above are the whole file.": "لا يحتوي الملف بعد على نص كافٍ لمسودة مفيدة، والوقائع الرئيسية أعلاه هي كل ما في الملف.",
  "Draft by a small local model, checked against the key facts above.": "مسودة كتبها نموذج محلي صغير، وطوبقت مع الوقائع الرئيسية أعلاه.",
  "Sentences that match no note are marked, and so are figures the notes don't contain.": "تُميَّز الجمل التي لا تطابق أي ملاحظة، وكذلك الأرقام غير الواردة في الملاحظات.",
  "It can still join two facts that belong apart, so read it against the notes below.": "قد يجمع بين واقعتين منفصلتين، لذا راجعه مقابل الملاحظات أدناه.",
  "Draft written by a small local model and checked against the sources: sentences that match no source are marked, and so are figures the sources don't contain.": "مسودة كتبها نموذج محلي صغير وطوبقت مع المصادر: تُميَّز الجمل التي لا تطابق أي مصدر، وكذلك الأرقام غير الواردة في المصادر.",
  "It can still join two points that belong apart, so read the cited articles before relying on it.": "قد يجمع بين نقطتين منفصلتين، لذا اقرأ المواد المستشهد بها قبل الاعتماد عليه.",
  "The most relevant in-force articles and key passages are shown instead.": "وتُعرض بدلاً من ذلك أهم المواد السارية والمقاطع الرئيسية.",
  "The Law Library is empty.": "مكتبة القوانين فارغة.",
  "Upload official law PDFs in the Law Library to enable research.": "ارفع ملفات القوانين الرسمية في مكتبة القوانين لتفعيل البحث.",
  "No in-force article in the Law Library matched this question.": "لم تطابق أي مادة سارية في مكتبة القوانين هذا السؤال.",
  "These are the most relevant in-force articles.": "هذه أهم المواد السارية ذات الصلة.",
  "Read them in full before relying on them.": "اقرأها كاملة قبل الاعتماد عليها.",
  "The law library could not be searched just now.": "تعذّر البحث في مكتبة القوانين الآن.",
  "Please try again.": "يرجى المحاولة مرة أخرى.",
  "Leads for review only -- similarity says nothing about the outcome of either case.": "مؤشرات للمراجعة فقط، والتشابه لا يدل على نتيجة أي من القضيتين.",
  "Connections are leads for a human to review, not conclusions.": "الروابط مؤشرات يراجعها شخص، وليست استنتاجات.",
  "Key sentences are quoted from the file.": "الجمل الرئيسية مقتبسة من الملف.",
  "Offence mentions show where a topic is discussed; they are not charges and say nothing about whether anything happened.": "تُظهر الإشارات إلى الجرائم مواضع ذكر الموضوع؛ وهي ليست تهماً ولا تدل على وقوع أي شيء.",
  "Lists differences in stated facts only.": "يسرد الاختلافات في الوقائع المذكورة فقط.",
  "It does not assess truthfulness or credibility.": "ولا يقيّم الصدق أو المصداقية.",
  "No point described in both sources states different figures, dates or times.": "لا توجد نقطة مذكورة في المصدرين بأرقام أو تواريخ أو أوقات مختلفة.",
};

const SENTENCE_TEMPLATES_AR: [RegExp, string][] = [
  [/^(\d+) sentence\(s\) that matched no (?:note|source) were removed\.$/, "حُذفت {0} جملة لم تطابق أي مصدر."],
  [/^(\d+) sentence\(s\) could not be matched to any source and are marked\.$/, "{0} جملة لم تطابق أي مصدر وهي مميّزة."],
  [/^(\d+) point\(s\) are described in both sources with different figures, dates or times\.$/, "{0} نقطة مذكورة في المصدرين بأرقام أو تواريخ أو أوقات مختلفة."],
];

/** Translate an explanation built from known English sentences; unknown sentences stay as they are. */
export function translateText(text: string | null | undefined, lang: string): string | null | undefined {
  if (lang !== "ar" || !text) return text;
  const sentences = text.match(/[^.!?]+(?:[.!?](?!\d)|$)(?:\s+|$)/g) ?? [text];
  // Rejoin fragments that a known sentence spans (e.g. "--" or ":" inside it).
  const out: string[] = [];
  let buffer = "";
  for (const raw of sentences) {
    buffer += raw;
    const s = buffer.trim();
    const exact = SENTENCES_AR[s];
    const template = SENTENCE_TEMPLATES_AR.find(([re]) => re.test(s));
    if (exact) { out.push(exact); buffer = ""; continue; }
    if (template) { const m = s.match(template[0])!; out.push(template[1].replace(/\{(\d+)\}/g, (_, i) => m[Number(i) + 1])); buffer = ""; continue; }
    if (!Object.keys(SENTENCES_AR).some((k) => k.startsWith(s))) { out.push(s); buffer = ""; }
  }
  if (buffer.trim()) out.push(buffer.trim());
  return out.join(" ");
}

/** Translate the explanation fields of a result object in place (and return it). */
export function localize<T>(value: T, lang: string): T {
  if (lang !== "ar" || !value || typeof value !== "object") return value;
  const v = value as Record<string, unknown>;
  for (const key of ["reason", "review_reason", "note", "disclaimer", "ai_summary"]) {
    if (typeof v[key] === "string") v[key] = translateText(v[key] as string, lang);
  }
  return value;
}
