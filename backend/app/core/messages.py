"""
Arabic wording for the messages the API sends back to a person.

Error text is written once, in English, at the place where the error is
raised -- 105 of those sites across the routers. Rather than thread a
language argument through all of them, the outgoing message is translated
here, in one place, from the language the browser asked for
(`Accept-Language`). A message with no entry here is sent unchanged, so an
untranslated string reaches the reader in English instead of disappearing.

Messages that carry a value (a file size, a user's name, a role list) are
matched by pattern and the captured values are placed into the Arabic
sentence, which is not always in the same order as the English one.
"""

from __future__ import annotations

import re

# Exact messages, keyed by the English text as it is raised.
ARABIC: dict[str, str] = {
    # -- auth and accounts -------------------------------------------------
    "Incorrect username or password.": "اسم المستخدم أو كلمة المرور غير صحيحة.",
    "This account has been disabled.": "تم تعطيل هذا الحساب.",
    "Your session has expired. Please sign in again.": "انتهت صلاحية جلستك. يرجى تسجيل الدخول مرة أخرى.",
    "Your current password is incorrect.": "كلمة المرور الحالية غير صحيحة.",
    "That username is already taken.": "اسم المستخدم مستخدم بالفعل.",
    "User not found.": "المستخدم غير موجود.",
    "You can't disable your own account or remove your own admin role.":
        "لا يمكنك تعطيل حسابك أو إزالة صلاحية المسؤول عن نفسك.",
    "At least one active administrator must remain.": "يجب أن يبقى مسؤول نظام نشط واحد على الأقل.",
    "Unknown role.": "دور غير معروف.",
    "Forbidden.": "هذا الإجراء غير مصرّح به.",
    # Worded by FastAPI/Starlette rather than by us, and still read by a person.
    "Not authenticated": "يلزم تسجيل الدخول.",
    "Not Found": "الصفحة غير موجودة.",
    "Method Not Allowed": "هذه الطريقة غير مسموح بها.",
    "Internal Server Error": "حدث خطأ في الخادم.",
    # -- cases -------------------------------------------------------------
    "Case not found.": "القضية غير موجودة.",
    "A case with that case number already exists.": "توجد قضية بهذا الرقم بالفعل.",
    "The assigned judge must be an active judge account.": "يجب أن يكون القاضي المكلَّف حساب قاضٍ نشطاً.",
    "Judges can update a case's status; other case details are edited by case staff.":
        "يمكن للقضاة تحديث حالة القضية، أما بقية تفاصيلها فيحرّرها موظفو القضية.",
    "Party not found on this case.": "الطرف غير موجود في هذه القضية.",
    "Person not found.": "الشخص غير موجود.",
    "Provide either person_id or new_person.": "أدخل إما person_id أو new_person.",
    "Choose a party or enter the person's details.": "اختر أحد الأطراف أو أدخل بيانات الشخص.",
    "Emirates ID must look like 784-YYYY-NNNNNNN-N.": "يجب أن تكون صيغة رقم الهوية الإماراتية 784-YYYY-NNNNNNN-N.",
    "Timeline event not found.": "حدث الجدول الزمني غير موجود.",
    # -- complaints --------------------------------------------------------
    "Complaint not found.": "الشكوى غير موجودة.",
    "A case has already been opened for this complaint.": "سبق فتح قضية لهذه الشكوى.",
    "Use 'Open case' to move a complaint to case_opened.": "استخدم «فتح قضية» لتحويل الشكوى إلى قضية.",
    "No complaint matches that reference number and tracking code.":
        "لا توجد شكوى مطابقة للرقم المرجعي ورمز المتابعة.",
    "Too many complaints from this connection. Please try again later.":
        "عدد كبير من الشكاوى من هذا الاتصال. يرجى المحاولة لاحقاً.",
    "Too many lookups. Please wait a few minutes.": "عدد كبير من عمليات الاستعلام. يرجى الانتظار بضع دقائق.",
    # -- evidence and files ------------------------------------------------
    "Evidence not found.": "الدليل غير موجود.",
    "Evidence not found on this case.": "الدليل غير موجود في هذه القضية.",
    "File not found.": "الملف غير موجود.",
    "The uploaded file is empty.": "الملف المرفوع فارغ.",
    "The stored file is missing. This has been recorded in the audit log.":
        "الملف المحفوظ مفقود، وقد سُجّل ذلك في سجل التدقيق.",
    "Signature checks work on scanned documents (images or PDF).":
        "يعمل فحص التوقيع على المستندات الممسوحة ضوئياً (صور أو ملفات PDF).",
    "Both sources need extracted text to compare. Wait for processing to finish.":
        "تحتاج المقارنة إلى نص مستخرج من كلا المصدرين. انتظر انتهاء المعالجة.",
    "Sources must look like 'evidence:<id>' or 'statement:<id>'.":
        "يجب أن تكون المصادر بصيغة 'evidence:<id>' أو 'statement:<id>'.",
    # -- hearings and the courtroom ---------------------------------------
    "Hearing not found.": "الجلسة غير موجودة.",
    "This hearing was cancelled.": "أُلغيت هذه الجلسة.",
    "Session not found.": "جلسة القاعة غير موجودة.",
    "This session has been closed.": "أُغلقت هذه الجلسة.",
    "Statement not found.": "الإفادة غير موجودة.",
    "Statement not found on this case.": "الإفادة غير موجودة في هذه القضية.",
    "No recording is stored for this statement.": "لا يوجد تسجيل محفوظ لهذه الإفادة.",
    "No one is currently at the stand in this session.": "لا يوجد أحد في منصة الشهادة في هذه الجلسة حالياً.",
    "Step the current person down before closing the session.":
        "أنزِل الشخص الحالي من المنصة قبل إغلاق الجلسة.",
    "The active statement record was missing; the stand has been cleared.":
        "سجل الإفادة النشط مفقود، وقد أُخليت المنصة.",
    "The presiding judge must be an active judge account.": "يجب أن يكون قاضي الجلسة حساب قاضٍ نشطاً.",
    "Statements are temporarily unavailable.": "الإفادات غير متاحة مؤقتاً.",
    "Statements are temporarily unavailable (MongoDB is not reachable).":
        "الإفادات غير متاحة مؤقتاً (تعذّر الوصول إلى MongoDB).",
    "The courtroom record store (MongoDB) is temporarily unavailable. Please retry in a moment.":
        "مخزن سجلات قاعة المحكمة (MongoDB) غير متاح مؤقتاً. يرجى إعادة المحاولة بعد قليل.",
    # -- law library and research -----------------------------------------
    "Law document not found.": "الوثيقة القانونية غير موجودة.",
    "This document is being indexed right now. Try again when it finishes.":
        "تجري فهرسة هذه الوثيقة الآن. حاول مرة أخرى بعد انتهائها.",
    "'In force until' can't be earlier than 'in force from'.":
        "لا يمكن أن يكون تاريخ «نافذ حتى» أسبق من تاريخ «نافذ من».",
    "Source URL must start with http:// or https://": "يجب أن يبدأ رابط المصدر بـ http:// أو https://",
    "Research limit reached for this hour. Please try again later.":
        "تم بلوغ حد البحث لهذه الساعة. يرجى المحاولة لاحقاً.",
    "Unknown action.": "إجراء غير معروف.",
    # -- whole-service failures (app/main.py) ------------------------------
    "The database is temporarily unavailable. Please retry in a moment.":
        "قاعدة البيانات غير متاحة مؤقتاً. يرجى إعادة المحاولة بعد قليل.",
    "A database error occurred. The request was not saved.": "حدث خطأ في قاعدة البيانات، ولم يُحفظ الطلب.",
    "Something went wrong on our side. The error has been logged.": "حدث خطأ لدينا، وقد سُجّل الخطأ.",
    "Invalid request.": "طلب غير صالح.",
    "The text contains a character that can't be stored.": "يحتوي النص على رمز لا يمكن حفظه.",
    # Validator messages (the field name is stripped off before lookup).
    "Please describe what happened in at least 20 characters.": "يرجى وصف ما حدث بما لا يقل عن 20 حرفاً.",
    "Enter a valid email address.": "أدخل عنوان بريد إلكتروني صحيحاً.",
    "Enter a valid phone number.": "أدخل رقم هاتف صحيحاً.",
    "Field required": "هذا الحقل مطلوب.",
    "The deadline must be a date between 2000 and 2100.": "يجب أن يكون الموعد النهائي تاريخاً بين عام 2000 و2100.",
}

# Messages that carry a value. The Arabic sentence places the captured
# groups where Arabic word order needs them, which is why these are
# templates rather than a prefix match.
_TEMPLATES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^Too many failed sign-in attempts\. Try again in (\d+) minutes\.$"),
     "عدد كبير من محاولات الدخول الفاشلة. حاول مرة أخرى بعد {0} دقيقة."),
    (re.compile(r"^Password must contain at least (\d+) characters and both letters and numbers\.$"),
     "يجب أن تحتوي كلمة المرور على {0} أحرف على الأقل وعلى حروف وأرقام معاً."),
    (re.compile(r"^Password must contain at least (\d+) characters\.$"),
     "يجب أن تحتوي كلمة المرور على {0} أحرف على الأقل."),
    (re.compile(r"^Password must contain both letters and numbers\.$"),
     "يجب أن تحتوي كلمة المرور على حروف وأرقام معاً."),
    (re.compile(r"^This action requires one of these roles: (.+)\.$"),
     "يتطلب هذا الإجراء أحد هذه الأدوار: {0}."),
    (re.compile(r"^File is larger than the (\d+) MB limit\.$"),
     "حجم الملف يتجاوز الحد المسموح ({0} ميغابايت)."),
    (re.compile(r"^File type '\.(.*)' is not accepted here\. Allowed: (.+)\.$"),
     "نوع الملف '.{0}' غير مقبول هنا. الأنواع المسموح بها: {1}."),
    (re.compile(r"^This exact file is already in the library as '(.+)'\.$"),
     "هذا الملف موجود في المكتبة بالفعل باسم '{0}'."),
    (re.compile(r"^Couldn't read that document \((.+)\)\.$"), "تعذّرت قراءة هذه الوثيقة ({0})."),
    (re.compile(r"^The document image couldn't be analysed \((.+)\)\.$"), "تعذّر تحليل صورة الوثيقة ({0})."),
    (re.compile(r"^The image couldn't be analysed \((.+)\)\.$"), "تعذّر تحليل الصورة ({0})."),
    (re.compile(r"^(.+) is still at the stand\. Step them down first\.$"),
     "{0} لا يزال في منصة الشهادة. أنزِله من المنصة أولاً."),
    (re.compile(r"^The writing model could not be loaded: (.*)$"), "تعذّر تحميل نموذج الكتابة: {0}"),
    (re.compile(r"^The writing model could not be unloaded: (.*)$"), "تعذّر إلغاء تحميل نموذج الكتابة: {0}"),
    # `deps.require_object` builds "<Thing> not found." for any record type.
    (re.compile(r"^(.+) not found\.$"), "{0} غير موجود."),
]


def translate(detail: object, lang: str) -> object:
    """The message in `lang`, or unchanged when there is no Arabic wording for it.

    Non-string details (the validation handler sends a list) pass through."""
    if lang != "ar" or not isinstance(detail, str):
        return detail
    exact = ARABIC.get(detail)
    if exact:
        return exact
    for pattern, arabic in _TEMPLATES:
        match = pattern.match(detail)
        if match:
            return arabic.format(*match.groups())
    return detail


def language_of(header: str | None) -> str:
    """"ar" when the browser asked for Arabic, otherwise "en".

    The frontend sends its own chosen language, so this is a plain check of
    the first tag rather than full q-value negotiation."""
    if not header:
        return "en"
    first = header.split(",")[0].strip().lower()
    return "ar" if first.startswith("ar") else "en"
