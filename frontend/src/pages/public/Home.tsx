import React from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, BookOpenCheck, CalendarClock, FileSearch, FolderKanban, Gavel, Inbox, Languages, Lock, Mic,
  ScrollText, ShieldCheck, Sparkles,
} from "lucide-react";
import { usePrefs } from "../../lib/prefs";

export default function Home() {
  const { t, dir } = usePrefs();
  const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight;

  const modules = [
    {
      icon: <Inbox />, title: t("Complaint intake & triage", "استقبال الشكاوى وفرزها"),
      body: t("Citizens file online and get a tracking code. AI suggests a category, department and possible duplicates for staff to confirm.",
        "يقدّم المواطن شكواه إلكترونياً ويحصل على رمز متابعة. يقترح الذكاء الاصطناعي التصنيف والجهة والشكاوى المكررة ليؤكدها الموظف."),
    },
    {
      icon: <FolderKanban />, title: t("Case workspace", "مساحة عمل القضية"),
      body: t("Parties, hearings, evidence, timeline, statements and research in one file, with a full activity trail.",
        "الأطراف والجلسات والأدلة والتسلسل الزمني والإفادات والأبحاث في ملف واحد مع سجل كامل للإجراءات."),
    },
    {
      icon: <FileSearch />, title: t("Evidence intelligence", "تحليل الأدلة"),
      body: t("Scans and PDFs are read with Arabic + English OCR, people, dates and amounts are extracted, and a SHA-256 fingerprint protects the chain of custody.",
        "تُقرأ المستندات الممسوحة وملفات PDF بالعربية والإنجليزية، وتُستخرج الأسماء والتواريخ والمبالغ، وتحمي بصمة SHA-256 سلسلة الحيازة."),
    },
    {
      icon: <CalendarClock />, title: t("Hearing scheduling", "جدولة الجلسات"),
      body: t("A court calendar that catches courtroom and judge double-bookings before they happen.",
        "تقويم للمحكمة يكتشف تعارض القاعات ومواعيد القضاة قبل حدوثه."),
    },
    {
      icon: <Mic />, title: t("Courtroom stand", "منصة الشهادة"),
      body: t("One person at a time: the clerk confirms identity, the statement is recorded and transcribed on this server — audio never leaves it.",
        "شخص واحد في كل مرة: يؤكد الكاتب الهوية، وتُسجَّل الإفادة وتُفرَّغ نصياً على الخادم نفسه دون إرسال الصوت إلى الخارج."),
    },
    {
      icon: <BookOpenCheck />, title: t("Cited legal research", "بحث قانوني موثّق"),
      body: t("Answers come only from the official law texts in the library, with article citations and an in-force date check.",
        "تأتي الإجابات حصراً من النصوص القانونية الرسمية في المكتبة مع الإحالة إلى المواد والتحقق من سريانها."),
    },
  ];

  return (
    <div>
      {/* Hero */}
      <section className="relative isolate overflow-hidden bg-night-950">
        <img
          src="/images/hero-dubai.jpg"
          alt={t("Downtown Dubai skyline", "أفق وسط مدينة دبي")}
          className="absolute inset-0 -z-10 size-full object-cover opacity-55"
          {...{ fetchpriority: "high" }}
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-night-950 via-night-950/70 to-night-950/30" />
        <div className="mx-auto max-w-7xl px-4 pb-20 pt-24 sm:px-6 lg:pb-28 lg:pt-32">
          <div className="max-w-3xl animate-slide-up">
            <span className="inline-flex items-center gap-2 rounded-full border border-gold-300/40 bg-gold-300/15 px-3 py-1 text-xs font-medium text-gold-100">
              <Sparkles className="size-3.5" aria-hidden />
              {t("Decision support — humans decide", "دعم القرار — والقرار للإنسان")}
            </span>
            <h1 className="mt-6 font-heading text-4xl font-bold leading-tight text-white sm:text-5xl lg:text-6xl">
              {t("Court case management and legal intelligence, built for the UAE.", "إدارة القضايا والذكاء القانوني، مصمَّمة لدولة الإمارات.")}
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-white/80">
              {t(
                "LexIntel brings complaints, cases, evidence, hearings and cited legal research into one secure, bilingual workspace for courts, prosecutors and lawyers.",
                "تجمع LexIntel الشكاوى والقضايا والأدلة والجلسات والبحث القانوني الموثّق في مساحة عمل آمنة ثنائية اللغة للمحاكم والنيابة والمحامين."
              )}
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link to="/complaints/new" className="aegov-btn btn-lg">
                {t("File a complaint", "تقديم شكوى")}
                <Arrow className="size-5" aria-hidden />
              </Link>
              <Link to="/complaints/track" className="aegov-btn btn-lg btn-outline !text-white !ring-white/60 hover:!bg-white/10">
                {t("Track a complaint", "متابعة شكوى")}
              </Link>
              <Link to="/login" className="aegov-btn btn-lg btn-link !text-white/85 hover:!text-white">
                {t("Staff sign in", "دخول الموظفين")}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-b border-aeblack-100 bg-whitely-50">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {[
            { icon: <Gavel />, title: t("No AI verdicts", "لا أحكام آلية"), body: t("Only a judge can enter a ruling.", "لا يُدخل الحكم إلا القاضي.") },
            { icon: <ShieldCheck />, title: t("Chain of custody", "سلسلة الحيازة"), body: t("Every view and download is logged.", "كل اطلاع وتنزيل مسجَّل.") },
            { icon: <Languages />, title: t("Arabic & English", "العربية والإنجليزية"), body: t("Full right-to-left interface.", "واجهة كاملة من اليمين إلى اليسار.") },
            { icon: <Lock />, title: t("Stays on your servers", "تبقى على خوادمك"), body: t("Speech-to-text and search run locally.", "التفريغ الصوتي والبحث يعملان محلياً.") },
          ].map((item) => (
            <div key={item.title} className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-600 [&_svg]:size-5">
                {item.icon}
              </span>
              <div>
                <div className="font-semibold">{item.title}</div>
                <div className="text-sm muted">{item.body}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Modules */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="max-w-2xl">
          <div className="text-sm font-semibold uppercase tracking-[0.14em] text-primary-600">{t("The platform", "المنصة")}</div>
          <h2 className="mt-2 font-heading text-3xl font-bold sm:text-4xl">
            {t("Every step of a case, connected", "كل مراحل القضية، مترابطة")}
          </h2>
          <p className="mt-3 muted">
            {t("From the first complaint to the judge's ruling, each module feeds the next — and every AI suggestion shows its reasoning.",
              "من الشكوى الأولى إلى حكم القاضي، تغذّي كل وحدة ما بعدها، ويوضّح كل اقتراح آلي أسبابه.")}
          </p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => (
            <div key={m.title} className="aegov-card card-bordered card-glow bg-whitely-50">
              <span className="grid size-12 place-items-center rounded-xl bg-primary-50 text-primary-600 [&_svg]:size-6">
                {m.icon}
              </span>
              <h3 className="card-title !text-lg">{m.title}</h3>
              <p className="text-sm muted">{m.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Split feature with photo */}
      <section className="bg-primary-50/60">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <div className="relative">
            <img
              src="/images/gavel-marble.jpg"
              alt={t("Judge's gavel on marble", "مطرقة القاضي على الرخام")}
              loading="lazy"
              className="aspect-[4/3] w-full rounded-2xl object-cover shadow-xl"
            />
            <div className="absolute -bottom-6 end-6 hidden rounded-xl bg-whitely-50 p-4 shadow-lg sm:block">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Gavel className="size-4 text-primary-600" aria-hidden />
                {t("Ruling entered by a judge", "حكم مُدخل من قاضٍ")}
              </div>
              <div className="mt-1 text-xs muted">{t("AI assistance is recorded, never decisive.", "المساعدة الآلية مسجَّلة ولا تكون حاسمة.")}</div>
            </div>
          </div>
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.14em] text-primary-600">{t("Explainable by design", "قابل للتفسير بطبيعته")}</div>
            <h2 className="mt-2 font-heading text-3xl font-bold">{t("A recommendation always shows its reasons", "كل توصية تُظهر أسبابها")}</h2>
            <ul className="mt-6 space-y-4">
              {[
                t("Case priority is a weighted list of factual signals you can read and override.", "أولوية القضية قائمة موزونة بمؤشرات واقعية يمكنك قراءتها وتعديلها."),
                t("Research answers cite the exact article and are checked against the in-force date.", "إجابات البحث تُحيل إلى المادة المحددة وتُفحص مقابل تاريخ السريان."),
                t("Document comparison lists factual differences only — never who is telling the truth.", "مقارنة المستندات تعرض الفروقات الواقعية فقط — دون الحكم على الصدق."),
                t("When an AI service is down, you still get a clear, non-AI result instead of an error.", "عند تعطل خدمة الذكاء الاصطناعي تحصل على نتيجة واضحة غير آلية بدلاً من خطأ."),
              ].map((text) => (
                <li key={text} className="flex gap-3">
                  <ScrollText className="mt-0.5 size-5 shrink-0 text-primary-600" aria-hidden />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Photo cards */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="grid gap-5 md:grid-cols-3">
          {[
            { img: "/images/microphone.jpg", title: t("Statements, recorded fairly", "إفادات مسجَّلة بإنصاف"), body: t("No emotion or 'lie detection' scoring — only who spoke, in what role, and what was said.", "لا تقييم للمشاعر أو 'كشف الكذب' — فقط من تحدّث وبأي صفة وماذا قال.") },
            { img: "/images/law-books.jpg", title: t("A law library you control", "مكتبة قانونية تتحكم بها"), body: t("Upload official law PDFs; articles are indexed in Arabic and English.", "ارفع ملفات القوانين الرسمية لتُفهرس المواد بالعربية والإنجليزية.") },
            { img: "/images/signing.jpg", title: t("Evidence you can trust", "أدلة موثوقة"), body: t("Every file is fingerprinted on upload and can be re-verified at any time.", "لكل ملف بصمة رقمية عند رفعه ويمكن التحقق منها في أي وقت.") },
          ].map((card) => (
            <article key={card.title} className="aegov-card card-bordered overflow-hidden bg-whitely-50 !p-0">
              <img src={card.img} alt="" loading="lazy" className="aspect-[16/10] w-full object-cover" />
              <div className="space-y-2 p-6">
                <h3 className="card-title !text-lg">{card.title}</h3>
                <p className="text-sm muted">{card.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative isolate overflow-hidden">
        <img src="/images/dubai-sunset.jpg" alt="" loading="lazy" className="absolute inset-0 -z-10 size-full object-cover" />
        <div className="absolute inset-0 -z-10 bg-night-950/70" />
        <div className="mx-auto flex max-w-7xl flex-col items-start gap-6 px-4 py-16 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-heading text-3xl font-bold text-white">{t("Need to report something?", "هل لديك ما تبلغ عنه؟")}</h2>
            <p className="mt-2 max-w-xl text-white/80">
              {t("File a complaint in a few minutes. You'll get a reference number and tracking code straight away.",
                "قدّم شكواك خلال دقائق، وستحصل فوراً على رقم مرجعي ورمز متابعة.")}
            </p>
          </div>
          <Link to="/complaints/new" className="aegov-btn btn-lg">
            {t("Start a complaint", "ابدأ الشكوى")}
            <Arrow className="size-5" aria-hidden />
          </Link>
        </div>
      </section>
    </div>
  );
}
