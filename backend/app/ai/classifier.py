"""
Complaint category classifier (Module 1): nearest-neighbour over sentence
embeddings.

Each complaint is compared with (a) a bilingual set of example complaints per
category and (b) complaints whose category a staff member has confirmed --
by opening a case or by correcting the category during review. So the
classifier learns the court's own practice as staff use the triage screen,
with no retraining step and no labelled dataset to maintain.

Why not the writing model: classification needs to be fast (it runs for every
public complaint), stable (the same text always gets the same answer) and
explainable ("closest to these earlier complaints"). Nearest-neighbour over
embeddings is all three; a small generative model is none of them.
"""

from __future__ import annotations

import logging
import math
import threading
import time
from typing import Callable

import numpy as np

from app.ai import embeddings

log = logging.getLogger("lexintel.ai.classifier")

CATEGORIES = ("criminal", "civil", "cybercrime", "traffic", "grievance")

SEED_EXAMPLES: dict[str, list[str]] = {
    "criminal": [
        "Someone broke into my apartment at night and stole my jewellery and laptop.",
        "A man assaulted me outside the mall and I was injured.",
        "My neighbour threatened to kill me and showed a knife.",
        "My wallet and phone were stolen from my car while it was parked.",
        "A group of people attacked my brother and beat him in the street.",
        "سرق شخص مجهول هاتفي ومحفظتي من السيارة أثناء توقفها.",
        "تعرضت للضرب والاعتداء من قبل شخص أمام المركز التجاري.",
        "هددني جاري بالقتل وأشهر في وجهي سكيناً.",
        "اقتحم لصوص منزلي ليلاً وسرقوا الذهب والأموال.",
        "يتعرض ابني للتحرش والاعتداء من شخص بالغ في الحي.",
    ],
    "civil": [
        "My landlord refuses to return my security deposit after I moved out.",
        "My employer has not paid my salary for three months.",
        "The company did not pay my end-of-service gratuity when my contract ended.",
        "A contractor took the payment and never finished the renovation work.",
        "I sold goods to a company and they refuse to pay the invoice.",
        "يرفض المالك إعادة مبلغ التأمين بعد انتهاء عقد الإيجار.",
        "لم يدفع صاحب العمل راتبي منذ ثلاثة أشهر.",
        "لم تصرف الشركة مكافأة نهاية الخدمة بعد انتهاء عقدي.",
        "استلم المقاول المبلغ ولم ينجز أعمال الصيانة المتفق عليها في العقد.",
        "أقرضت صديقي مبلغاً من المال ويرفض سداد الدين.",
    ],
    "cybercrime": [
        "My WhatsApp account was hacked and the person is asking my contacts for money.",
        "I received a fake bank SMS, entered my card details and money was taken from my account.",
        "Someone is blackmailing me online and threatening to publish my private photos.",
        "A fake online shop took my payment and never delivered anything.",
        "Someone created a fake Instagram account using my name and photos to insult people.",
        "تم اختراق حسابي في واتساب وأصبح المخترق يطلب المال من أصدقائي.",
        "وصلتني رسالة نصية مزيفة باسم البنك وتم سحب مبلغ من بطاقتي.",
        "يبتزني شخص عبر الإنترنت ويهدد بنشر صوري الخاصة.",
        "دفعت لمتجر إلكتروني وهمي ولم أستلم أي طلب.",
        "أنشأ شخص حساباً مزيفاً باسمي على مواقع التواصل الاجتماعي ويسيء للآخرين.",
    ],
    "traffic": [
        "A truck hit my car on Sheikh Zayed Road and the driver fled the scene.",
        "I was involved in a collision at a roundabout and the other driver refuses to accept fault.",
        "A car is always parked blocking the entrance of our building.",
        "I received a speeding fine for a day my car was in the workshop.",
        "A reckless driver keeps racing on our residential street at night.",
        "صدمت شاحنة سيارتي على شارع الشيخ زايد وهرب السائق.",
        "وقع حادث تصادم عند الدوار والسائق الآخر يرفض تحمل المسؤولية.",
        "وصلتني مخالفة سرعة في يوم كانت سيارتي فيه في الورشة.",
        "سائق متهور يقود بسرعة عالية في الحي السكني كل ليلة.",
        "تركن سيارة باستمرار أمام مدخل المبنى وتغلق الطريق.",
    ],
    "grievance": [
        "My visa application has been delayed for months without any response.",
        "The municipality has not responded to my building permit request.",
        "The employee at the service centre was rude and refused to help me.",
        "There is constant loud noise from a construction site at night near my home.",
        "My trade licence renewal is stuck and nobody answers the phone.",
        "تأخرت معاملة التأشيرة الخاصة بي لعدة أشهر دون أي رد.",
        "لم ترد البلدية على طلب رخصة البناء الذي قدمته.",
        "تعامل الموظف في مركز الخدمة معي بشكل غير لائق ورفض مساعدتي.",
        "يوجد إزعاج مستمر من موقع بناء قريب من منزلي في الليل.",
        "تجديد الرخصة التجارية متوقف ولا أحد يرد على الهاتف.",
    ],
}

_TEMPERATURE = 0.08       # softmax sharpness over category scores
_TOP_K = 3                # neighbours averaged per category
_MIN_SIMILARITY = 0.28    # below this nothing in memory resembles the complaint
_LEARNED_TTL = 600.0


class ComplaintClassifier:
    def __init__(self, learned_loader: Callable[[], list[tuple[str, str]]] | None = None):
        self._learned_loader = learned_loader
        self._learned: list[tuple[str, str]] = []
        self._learned_at: float | None = None   # None = never loaded (not "loaded at time 0")
        self._lock = threading.Lock()

    def _examples(self) -> list[tuple[str, str, str]]:
        """(text, category, source) -- seeds plus recent staff decisions."""
        if self._learned_loader and self._stale():
            with self._lock:
                if self._stale():
                    try:
                        self._learned = [(t, c) for t, c in self._learned_loader() if c in CATEGORIES and t]
                    except Exception as exc:
                        log.warning("could not load staff-labelled complaints: %s", exc)
                    self._learned_at = time.monotonic()
        rows = [(text, cat, "example") for cat, texts in SEED_EXAMPLES.items() for text in texts]
        rows += [(text[:1000], cat, "staff decision") for text, cat in self._learned]
        return rows

    def _stale(self) -> bool:
        return self._learned_at is None or time.monotonic() - self._learned_at > _LEARNED_TTL

    def refresh(self) -> None:
        self._learned_at = None

    def classify(self, text: str, citizen_category: str | None = None) -> dict:
        """Raises embeddings.ModelUnavailable when the model can't run (caller uses keywords)."""
        # A re-classified complaint must not match its own confirmed copy.
        examples = [e for e in self._examples() if e[0] != text[:1000]]
        matrix = embeddings.embed([e[0] for e in examples])
        query = embeddings.embed_document(text)
        sims = matrix @ query

        category_scores: dict[str, float] = {}
        for cat in CATEGORIES:
            cat_sims = np.sort(sims[[i for i, e in enumerate(examples) if e[1] == cat]])[::-1]
            category_scores[cat] = float(cat_sims[:_TOP_K].mean()) if len(cat_sims) else 0.0

        exps = {c: math.exp((s - max(category_scores.values())) / _TEMPERATURE) for c, s in category_scores.items()}
        total = sum(exps.values())
        probabilities = {c: round(v / total, 3) for c, v in exps.items()}
        best = max(probabilities, key=probabilities.get)
        best_similarity = category_scores[best]

        neighbours = []
        for i in np.argsort(-sims)[:3]:
            ex_text, ex_cat, ex_source = examples[int(i)]
            neighbours.append({"text": ex_text[:180], "category": ex_cat, "similarity": round(float(sims[i]), 2),
                               "source": ex_source})

        if best_similarity < _MIN_SIMILARITY:
            chosen = citizen_category if citizen_category in CATEGORIES else best
            confidence = 0.3
            reason = ("Nothing in the examples or earlier decisions closely resembles this complaint, "
                      "so the category chosen by the citizen was kept.")
        else:
            chosen = best
            confidence = min(0.95, probabilities[best])
            runner_up = sorted(probabilities, key=probabilities.get, reverse=True)[1]
            reason = (f"Closest to earlier {best} complaints (similarity {best_similarity:.2f}); "
                      f"next most likely: {runner_up} ({probabilities[runner_up]:.0%}).")

        return {
            "case_type": chosen,
            "confidence": round(confidence, 2),
            "reason": reason,
            "details": {
                "method": "semantic",
                "model": embeddings.settings.embedding_model,
                "probabilities": probabilities,
                "neighbours": neighbours,
                "learned_examples": len(self._learned),
            },
        }


def _load_staff_labels() -> list[tuple[str, str]]:
    from app.db.base import get_session
    from app.db.postgres_repository import ComplaintRepository

    with get_session() as db:
        return ComplaintRepository(db).staff_labelled(limit=400)


classifier = ComplaintClassifier(_load_staff_labels)
