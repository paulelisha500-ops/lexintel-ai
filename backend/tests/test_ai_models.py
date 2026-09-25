"""
The task models in app/ai, run for real (multilingual MiniLM on CPU) plus
their no-model fallbacks. No database and no writing model needed.

    docker compose exec backend python -m tests.test_ai_models
"""
import tests._env  # noqa: F401  (must be first)

import threading
import time

from app.agents import graph_orchestrator as go
from app.ai import drafting, embeddings, grounding, offences, slots, summarize
from app.ai.classifier import ComplaintClassifier
from app.ai.text import has_foreign_script, language_of, split_sentences
from app.core import llm

failures = []


def check(name, cond, info=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  -> {info}"))
    if not cond:
        failures.append(name)


print("text helpers")
check("splits Arabic and English sentences", len(split_sentences("First sentence here. الجملة الثانية هنا؟ Third one follows!")) == 3)
check("language detection", language_of("ما هي مدة الإشعار؟") == "ar" and language_of("What is the notice?") == "en")
check("foreign script detection", has_foreign_script("في法庭") and not has_foreign_script("court المحكمة"))

print("complaint classifier (seed examples only)")
clf = ComplaintClassifier(None)
cases = [
    ("Somebody used my credit card details online to buy things I never ordered", "cybercrime"),
    ("My flatmate took my gold chain from my room while I was at work", "criminal"),
    ("The company I worked for still owes me two months of wages", "civil"),
    ("A taxi reversed into my parked car at the mall and drove away", "traffic"),
    ("I have waited six months for the ministry to issue my certificate", "grievance"),
    ("تلقيت اتصالاً من شخص يدعي أنه من البنك وطلب رمز التحقق ثم سحب أموالي", "cybercrime"),
    ("المستأجر لم يدفع الإيجار منذ أربعة أشهر ويرفض إخلاء الشقة", "civil"),
    ("اصطدمت بي سيارة عند الإشارة الحمراء والسائق كان يستخدم الهاتف", "traffic"),
]
right = sum(clf.classify(text, "grievance")["case_type"] == want for text, want in cases)
check(f"classifies unseen complaints in both languages ({right}/{len(cases)})", right >= len(cases) - 1)
r = clf.classify(cases[0][0], "grievance")
check("explains with probabilities and nearest examples", r["details"]["neighbours"] and abs(sum(r["details"]["probabilities"].values()) - 1) < 0.01)
learned = ComplaintClassifier(lambda: [("Noise from the mosque loudspeaker renovation works at night", "civil")])
learned_r = learned.classify("Noise from the mosque loudspeaker renovation works at night", "grievance")
check("a staff-labelled complaint never matches itself", all(n["source"] == "example" for n in learned_r["details"]["neighbours"]))
check("staff decisions count as examples", learned.classify("Loud renovation work at night near the mosque", None)["details"]["learned_examples"] == 1)

print("duplicate thresholds")
a = "My WhatsApp account was hacked yesterday and the hacker is asking my friends to send money"
same = "تم اختراق حسابي في واتساب أمس والمخترق يطلب من أصدقائي تحويل المال"
other = "I bought a phone from an Instagram shop and they never delivered it"
v = embeddings.embed([a, same, other])
dup = {"meaning": float(v[0] @ v[1]), "wording": 0.0}
not_dup = {"meaning": float(v[0] @ v[2]), "wording": go.token_similarity(a, other)}
check("same incident in Arabic is a likely duplicate", go.is_likely_duplicate(dup), dup)
check("different incident of the same kind is not", not go.is_likely_duplicate(not_dup) and not go.is_candidate(not_dup), not_dup)
check("word-overlap rule still works without the model", go.is_likely_duplicate({"similarity": 0.8}) and not go.is_candidate({"similarity": 0.1}))

print("offence mentions and legal references")
doc = ("The defendant entered the victim's apartment without permission. He took a laptop and 2,000 dirhams in cash. "
       "He then punched the victim in the face. The weather that evening was clear. "
       "وفي اليوم التالي أرسل المتهم رسالة يهدد فيها المجني عليه بالقتل.")
found = {m["offence"] for m in offences.offence_mentions(doc)["mentions"]}
check("finds theft, assault, trespass and threat (EN + AR)", {"theft", "assault", "trespass", "threat"} <= found, found)
check("does not invent unrelated offences", not found & {"money_laundering", "bribery", "drugs", "forgery"}, found)
pay_dispute = ("My fixed-term contract ended on 31/12/2025 after four years of continuous service. "
               "I received my salary for December 2025 but no end-of-service gratuity. "
               "The company paid AED 12,000 on 20/01/2026 and calculates the gratuity as AED 26,000, not AED 34,000.")
check("an ordinary pay dispute is not tagged with offences",
      offences.offence_mentions(pay_dispute)["mentions"] == [],
      offences.offence_mentions(pay_dispute)["mentions"])
theft_report = ("On the evening of 12/09/2026 three laptops and two phones were taken from the display area. "
                "An employee saw a man put the items into a bag and leave through the service corridor.")
theft_found = [m["offence"] for m in offences.offence_mentions(theft_report)["mentions"]]
check("a plainly worded theft report is tagged theft and nothing else", theft_found == ["theft"], theft_found)
refs = [r["reference"] for r in offences.legal_references(
    "Under Article 391 of the Penal Code and Federal Decree-Law No. 31 of 2021, and المادة (٤٣) من المرسوم بقانون اتحادي رقم ٣٣ لسنة ٢٠٢١")]
check("cited laws found in both languages", {"Article 391 of the Penal Code", "Law No. 31 of 2021", "المادة 43", "رقم 33 لسنة 2021"} <= set(refs), refs)

print("summaries and key passages")
long_text = " ".join([doc, "Either party may terminate the employment contract with at least 30 days written notice.",
                      "The police arrived at 10:40 pm and took statements from two neighbours."])
s = summarize.extractive_summary(long_text, max_sentences=3)
check("extractive summary picks original sentences", s["method"] == "semantic" and all(x["text"] in long_text for x in s["sentences"]), s)
kp = summarize.key_passages("How much notice ends an employment contract?", [doc, long_text])
check("key passage answers the question", kp["passages"] and "30 days" in kp["passages"][0]["text"], kp)

print("grounding check")
src = ["Either party may terminate the employment contract for a legitimate reason, provided the other party is notified in writing at least 30 days and no more than 90 days in advance.",
       "A foreign worker who completes one year or more of continuous service is entitled to end-of-service gratuity."]
answer = ("Either party may end an employment contract for a legitimate reason with written notice of 30 to 90 days. "
          "A worker with a year of continuous service is entitled to gratuity. "
          "This is the legal requirement in most countries, including Germany.")
g = grounding.check(answer, src)
check("supported sentences get computed citations", g["sentences"][0]["sources"] == [1] and g["sentences"][1]["sources"] == [2], g)
check("invented sentence is flagged", g["sentences"][2]["support"] == "unsupported", g["sentences"][2])
check("citations are placed before the full stop", "days [1]." in grounding.render(g))
# Meaning-matching alone does not notice changed numbers, so figures are checked too.
figure_sources = ["A rear-end collision was reported at 09:15 on 3 March 2026 near the Al Wasl Road junction.",
                  "The owner states the damage was estimated at AED 6,000 by the workshop."]
figure_draft = ("The collision happened at approximately 2:30 PM on October 5, 2026 on Al Wasl Road. "
                "The owner estimates the damage at AED 6,000.")
fg = grounding.check(figure_draft, figure_sources)
check("a sentence that restates the time and date wrongly is flagged",
      fg["sentences"][0]["support"] == "unsupported" and fg["sentences"][0]["invented_figures"], fg["sentences"][0])
ar_source = ["يجوز لأي من طرفي عقد العمل إنهاؤه لسبب مشروع، على أن يخطر الطرف الآخر كتابياً قبل مدة لا تقل عن ثلاثين يوماً ولا تزيد على تسعين يوماً."]
ar_wrong = grounding.check("مدة الإخطار هي بين ثلاثين يوماً وسبعين يوماً.", ar_source)["sentences"][0]
check("a wrong number written in Arabic words is caught (سبعين vs تسعين)",
      ar_wrong["support"] == "unsupported" and ar_wrong["invented_figures"] == ["70"], ar_wrong)
ar_right = grounding.check("مدة الإخطار هي بين ثلاثين يوماً وتسعين يوماً.", ar_source)["sentences"][0]
check("the same sentence with the right number is not flagged", not ar_right["invented_figures"], ar_right)
check("a sentence whose figures are in the sources is kept",
      fg["sentences"][1]["support"] == "supported" and not fg["sentences"][1]["invented_figures"], fg["sentences"][1])

print("drafting gates")
check("wrong-language drafts are withheld", drafting.language_problem("The notice period is 30 days.", "ar") is not None)
check("mixed-script drafts are withheld", drafting.language_problem("جلسة المحكمة هي meeting في法庭", "ar") is not None)
check("clean Arabic passes", drafting.language_problem("يجب إخطار الطرف الآخر قبل ثلاثين يوماً.", "ar") is None)
padded = ("The rear vehicle struck the front vehicle while both were moving towards the junction. "
          "The owner estimates the damage at AED 6,000. "
          "The rear vehicle struck the front vehicle while both were moving towards the junction.")
check("a draft that repeats itself keeps each point once",
      drafting._drop_repeats(padded).count("rear vehicle struck") == 1, drafting._drop_repeats(padded))
events = list(drafting.stream_grounded_draft([{"role": "user", "content": "x"}], src, "en"))
check("drafting switched off ends with one draft event, no exception",
      events[-1][0] == "draft" and events[-1][1]["status"] == "ai_unavailable", events)

print("memory guard")
from app.ai import memory  # noqa: E402

check("free memory is readable on this machine", isinstance(memory.available_mb(), int))
_real_available = memory.available_mb
try:
    memory.available_mb = lambda: 300          # a nearly full machine
    check("a nearly full machine blocks both models",
          not memory.enough_for(memory.EMBEDDINGS_MB) and not memory.enough_for(memory.WRITING_MODEL_MB))
    try:
        embeddings._load()
        loaded_anyway = True
    except RuntimeError as exc:
        loaded_anyway = "memory" not in str(exc)
    check("the embedding model refuses to load rather than starve the machine", not loaded_anyway)
    # Short on memory, the big optional model gives way to the small one everything needs.
    from app.core import llm as llm_module
    freed = []
    real_load_model, real_enabled = llm_module.load_model, llm_module.enabled
    llm_module.load_model = lambda unload=False: freed.append(unload)
    llm_module.enabled = lambda: True
    try:
        try:
            embeddings._load()
        except RuntimeError:
            pass
        check("the writing model is unloaded to make room for the embedding model", freed == [True], freed)
    finally:
        llm_module.load_model, llm_module.enabled = real_load_model, real_enabled

    memory.available_mb = lambda: 4000         # plenty
    check("with memory free, both models are allowed",
          memory.enough_for(memory.EMBEDDINGS_MB) and memory.enough_for(memory.WRITING_MODEL_MB))
    memory.available_mb = lambda: None         # unreadable (not Linux)
    check("unknown memory does not disable the AI", memory.enough_for(memory.WRITING_MODEL_MB))
finally:
    memory.available_mb = _real_available

print("model slots: idle unload and failure memory")
loads = []
slot = slots.ModelSlot("test-slot", lambda: loads.append(1) or object(), idle_seconds=0.05)
with slot.use():
    pass
check("loads on first use", slot.loaded() and len(loads) == 1)
time.sleep(0.1)
check("unloads when idle", slot.unload_if_idle(time.monotonic()) and not slot.loaded())
with slot.use():
    check("never unloads while in use", not slot.unload_if_idle(time.monotonic() + 10))
bad = slots.ModelSlot("broken-slot", lambda: 1 / 0, idle_seconds=60)
for _ in range(2):
    try:
        with bad.use():
            pass
    except slots.ModelUnavailable:
        pass
check("a failed load is remembered instead of retried every call", not bad.available() and "ZeroDivisionError" in bad.status()["error"])
off = slots.ModelSlot("off-slot", object, idle_seconds=60, enabled=lambda: False)
try:
    with off.use():
        pass
    check("disabled slot refuses", False)
except slots.ModelUnavailable:
    check("disabled slot refuses", True)

print("writing-model queue")
llm.settings.llm_max_waiting = 1
held = threading.Event()
release = threading.Event()


def hold_turn():
    with llm._turn():
        held.set()
        release.wait(5)


t1 = threading.Thread(target=hold_turn)
t1.start()
held.wait(5)
t2 = threading.Thread(target=lambda: llm._turn().__enter__())  # waits in line
t2.daemon = True
t2.start()
time.sleep(0.2)
try:
    with llm._turn():
        pass
    busy = False
except llm.LLMBusy:
    busy = True
check("beyond the waiting line, drafts get 'busy' at once instead of piling up", busy)
release.set()
t1.join(5)

print(f"\n{'ALL AI MODEL CHECKS PASSED' if not failures else f'{len(failures)} FAILED: {failures}'}")
raise SystemExit(1 if failures else 0)
