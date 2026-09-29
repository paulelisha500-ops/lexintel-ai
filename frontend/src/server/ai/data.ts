/** Data ported verbatim from the Python backend (app/ai/offences.py, app/ai/classifier.py, app/agents/graph_orchestrator.py). */

export const OFFENCES: Record<string, { en: string; ar: string; describe: string[]; words: string[] }> = {
  "theft": {
    "en": "Theft",
    "ar": "سرقة",
    "describe": [
      "someone stole property or took belongings without permission",
      "a robbery or burglary of a home, car, shop or warehouse",
      "he took the phone, laptop and cash that belonged to the victim",
      "the lock was cut and goods were missing from the store in the morning",
      "laptops and phones were taken from the display area of the shop",
      "سرق شخص ممتلكات أو أخذ أغراضاً دون إذن",
      "سطو أو سرقة من منزل أو سيارة أو محل أو مستودع",
      "أخذ المتهم الهاتف والنقود المملوكة للمجني عليه",
      "كُسر القفل وفُقدت البضائع من المخزن"
    ],
    "words": [
      "stole",
      "stolen",
      "theft",
      "took",
      "taken",
      "missing",
      "burglar",
      "robbery",
      "shoplift",
      "سرق",
      "سرقة",
      "سطو",
      "مسروق",
      "فقد",
      "اختفت"
    ]
  },
  "fraud": {
    "en": "Fraud / deception",
    "ar": "احتيال",
    "describe": [
      "obtaining money by deceiving the victim with false promises or a fake identity",
      "a scam where the victim paid for something that was never delivered",
      "a fake message or website tricked the victim into giving card details or a one-time password",
      "the victim was deceived into transferring money to an account controlled by the sender",
      "الاستيلاء على المال بالخداع أو بوعود كاذبة أو بانتحال صفة",
      "عملية نصب دفع فيها الضحية مالاً مقابل شيء لم يسلم",
      "رسالة أو صفحة مزيفة خدعت الضحية للحصول على بيانات البطاقة أو رمز التحقق",
      "I opened the link in the message and entered my card number and the code that arrived by SMS, then money left my account",
      "فتحت الرابط في الرسالة وأدخلت رقم بطاقتي ورمز التحقق ثم خرج المال من حسابي"
    ],
    "words": [
      "fraud",
      "scam",
      "deceiv",
      "fake",
      "phishing",
      "impersonat",
      "one-time password",
      "otp",
      "tricked",
      "card number",
      "verification code",
      "opened the link",
      "clicked the link",
      "احتيال",
      "نصب",
      "خداع",
      "مزيف",
      "انتحال",
      "تصيد",
      "رمز التحقق",
      "رقم البطاقة"
    ]
  },
  "breach_of_trust": {
    "en": "Breach of trust",
    "ar": "خيانة الأمانة",
    "describe": [
      "money or property entrusted to a person was kept or misused by them",
      "استولى شخص على مال أو منقول سلم إليه على سبيل الأمانة"
    ],
    "words": [
      "entrust",
      "breach of trust",
      "safekeeping",
      "أمانة",
      "عهدة"
    ]
  },
  "embezzlement": {
    "en": "Embezzlement",
    "ar": "اختلاس",
    "describe": [
      "an employee took company or public funds that were under their control",
      "اختلس موظف أموالاً عامة أو أموال الشركة التي في عهدته"
    ],
    "words": [
      "embezzl",
      "public funds",
      "company funds",
      "petty cash",
      "اختلاس",
      "المال العام"
    ]
  },
  "assault": {
    "en": "Assault / bodily harm",
    "ar": "اعتداء وإيذاء",
    "describe": [
      "a person was hit, beaten or physically attacked and injured",
      "he punched the victim in the face and caused a broken nose",
      "تعرض شخص للضرب أو الاعتداء الجسدي وأصيب بجروح"
    ],
    "words": [
      "assault",
      "punch",
      "beat",
      "attack",
      "injur",
      "wound",
      "struck the victim",
      "اعتداء",
      "ضرب",
      "إصابة",
      "جرح",
      "لكم"
    ]
  },
  "threat": {
    "en": "Threats",
    "ar": "تهديد",
    "describe": [
      "a person threatened to kill or harm someone",
      "هدد شخص غيره بالقتل أو بإلحاق الأذى به"
    ],
    "words": [
      "threat",
      "threaten",
      "تهديد",
      "هدد",
      "يهدد"
    ]
  },
  "insult_defamation": {
    "en": "Insult / defamation",
    "ar": "سب وقذف",
    "describe": [
      "insulting or defaming a person publicly or on social media",
      "سب أو قذف شخص علناً أو عبر وسائل التواصل الاجتماعي"
    ],
    "words": [
      "insult",
      "defam",
      "slander",
      "libel",
      "سب",
      "قذف",
      "إهانة",
      "تشهير"
    ]
  },
  "harassment": {
    "en": "Harassment",
    "ar": "تحرش",
    "describe": [
      "sexual harassment or repeated unwanted advances towards a person",
      "تحرش جنسي أو ملاحقة شخص بأفعال أو أقوال غير مرغوب فيها"
    ],
    "words": [
      "harass",
      "stalk",
      "unwanted advances",
      "تحرش",
      "ملاحقة",
      "مضايقة"
    ]
  },
  "forgery": {
    "en": "Forgery",
    "ar": "تزوير",
    "describe": [
      "a document, signature or official paper was forged or falsified",
      "تزوير مستند أو توقيع أو محرر رسمي"
    ],
    "words": [
      "forg",
      "falsif",
      "counterfeit",
      "fake signature",
      "تزوير",
      "مزور"
    ]
  },
  "bribery": {
    "en": "Bribery",
    "ar": "رشوة",
    "describe": [
      "offering or accepting money to influence an official's decision",
      "عرض أو قبول مبلغ مالي للتأثير على قرار موظف"
    ],
    "words": [
      "bribe",
      "bribery",
      "kickback",
      "رشوة",
      "رشا"
    ]
  },
  "dishonoured_cheque": {
    "en": "Dishonoured cheque",
    "ar": "شيك بدون رصيد",
    "describe": [
      "a cheque bounced because the account had insufficient funds",
      "رجع الشيك لعدم وجود رصيد كاف في الحساب"
    ],
    "words": [
      "cheque",
      "check bounced",
      "insufficient funds",
      "شيك",
      "رصيد"
    ]
  },
  "money_laundering": {
    "en": "Money laundering",
    "ar": "غسل الأموال",
    "describe": [
      "moving or hiding the source of illegally obtained money through transfers",
      "إخفاء مصدر أموال غير مشروعة أو تحويلها عبر حسابات"
    ],
    "words": [
      "launder",
      "proceeds of crime",
      "hide the source",
      "غسل الأموال",
      "غسيل أموال"
    ]
  },
  "drugs": {
    "en": "Narcotics",
    "ar": "مخدرات",
    "describe": [
      "possession, use or selling of drugs or narcotic substances",
      "حيازة أو تعاطي أو بيع مواد مخدرة"
    ],
    "words": [
      "drug",
      "narcotic",
      "cannabis",
      "cocaine",
      "hashish",
      "مخدر",
      "مخدرات",
      "تعاطي"
    ]
  },
  "cyber_intrusion": {
    "en": "Hacking / unauthorised access",
    "ar": "اختراق إلكتروني",
    "describe": [
      "an account, phone or computer system was hacked or accessed without authorisation",
      "اختراق حساب أو هاتف أو نظام إلكتروني دون تصريح"
    ],
    "words": [
      "hack",
      "unauthorised access",
      "unauthorized access",
      "breached the account",
      "logged into my account",
      "اختراق",
      "اخترق",
      "دخول غير مصرح"
    ]
  },
  "online_blackmail": {
    "en": "Online blackmail",
    "ar": "ابتزاز إلكتروني",
    "describe": [
      "threatening to publish private photos or information online unless paid",
      "التهديد بنشر صور أو معلومات خاصة عبر الإنترنت مقابل المال"
    ],
    "words": [
      "blackmail",
      "extort",
      "publish my photos",
      "publish the photos",
      "unless i pay",
      "unless i paid",
      "ابتزاز",
      "ينشر صوري",
      "بنشر الصور"
    ]
  },
  "property_damage": {
    "en": "Damage to property",
    "ar": "إتلاف ممتلكات",
    "describe": [
      "someone deliberately damaged or destroyed a car, house or other property",
      "أتلف شخص عمداً سيارة أو منزلاً أو ممتلكات للغير"
    ],
    "words": [
      "vandal",
      "destroyed",
      "smashed",
      "broke the window",
      "damaged deliberately",
      "إتلاف",
      "أتلف",
      "تخريب"
    ]
  },
  "trespass": {
    "en": "Trespass",
    "ar": "انتهاك حرمة مسكن",
    "describe": [
      "entering a home or private property without permission",
      "دخول مسكن أو ملكية خاصة دون إذن صاحبها"
    ],
    "words": [
      "without permission",
      "trespass",
      "broke into",
      "entered the apartment",
      "entered the house",
      "دون إذن",
      "بغير إذن",
      "اقتحم",
      "انتهاك حرمة"
    ]
  },
  "reckless_driving": {
    "en": "Dangerous driving",
    "ar": "قيادة متهورة",
    "describe": [
      "driving recklessly, racing or driving under the influence and endangering others",
      "القيادة بتهور أو تحت تأثير الكحول بشكل يعرض الآخرين للخطر"
    ],
    "words": [
      "reckless",
      "dangerous driving",
      "speeding",
      "racing",
      "under the influence",
      "drunk",
      "تهور",
      "سرعة زائدة",
      "تفحيط",
      "تحت تأثير"
    ]
  },
  "hit_and_run": {
    "en": "Leaving the scene of an accident",
    "ar": "الفرار من موقع الحادث",
    "describe": [
      "a driver caused an accident and fled the scene without stopping",
      "the driver left the scene of the accident before the police arrived",
      "تسبب سائق في حادث وفر من الموقع دون توقف"
    ],
    "words": [
      "left the scene",
      "fled the scene",
      "hit and run",
      "did not stop",
      "must stop immediately",
      "فر من الموقع",
      "هرب",
      "لاذ بالفرار"
    ]
  }
};

export const SEED_EXAMPLES: Record<string, string[]> = {
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
    "يتعرض ابني للتحرش والاعتداء من شخص بالغ في الحي."
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
    "أقرضت صديقي مبلغاً من المال ويرفض سداد الدين."
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
    "أنشأ شخص حساباً مزيفاً باسمي على مواقع التواصل الاجتماعي ويسيء للآخرين."
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
    "تركن سيارة باستمرار أمام مدخل المبنى وتغلق الطريق."
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
    "تجديد الرخصة التجارية متوقف ولا أحد يرد على الهاتف."
  ]
};

export const KEYWORDS: Record<string, string[]> = {
  "cybercrime": [
    "hack",
    "hacked",
    "phishing",
    "scam",
    "online",
    "website",
    "email",
    "password",
    "otp",
    "whatsapp",
    "instagram",
    "social media",
    "cyber",
    "blackmail",
    "sextortion",
    "crypto",
    "bank card",
    "sms",
    "اختراق",
    "احتيال إلكتروني",
    "تصيد",
    "ابتزاز",
    "حساب",
    "رسالة نصية",
    "الإنترنت",
    "واتساب",
    "بطاقة"
  ],
  "traffic": [
    "accident",
    "collision",
    "crash",
    "car",
    "vehicle",
    "speeding",
    "parking",
    "road",
    "driver",
    "plate",
    "radar",
    "hit and run",
    "traffic",
    "lane",
    "truck",
    "حادث",
    "سيارة",
    "مرور",
    "تصادم",
    "مخالفة",
    "سرعة",
    "طريق",
    "سائق",
    "مركبة"
  ],
  "criminal": [
    "theft",
    "stole",
    "stolen",
    "assault",
    "attack",
    "robbery",
    "threat",
    "violence",
    "drugs",
    "murder",
    "fight",
    "harassment",
    "weapon",
    "knife",
    "burglary",
    "break-in",
    "abuse",
    "kidnap",
    "سرقة",
    "اعتداء",
    "تهديد",
    "ضرب",
    "مخدرات",
    "تحرش",
    "عنف",
    "سلاح",
    "سطو"
  ],
  "civil": [
    "contract",
    "rent",
    "landlord",
    "tenant",
    "salary",
    "wages",
    "debt",
    "payment",
    "employer",
    "refund",
    "deposit",
    "property",
    "cheque",
    "check bounced",
    "gratuity",
    "invoice",
    "compensation",
    "lease",
    "عقد",
    "إيجار",
    "راتب",
    "دين",
    "مالك",
    "مستأجر",
    "تعويض",
    "شيك",
    "مستحقات"
  ],
  "grievance": [
    "government",
    "service",
    "delay",
    "municipality",
    "noise",
    "permit",
    "license",
    "visa",
    "public office",
    "complaint about",
    "employee rude",
    "waiting",
    "شكوى",
    "خدمة",
    "تأخير",
    "بلدية",
    "إزعاج",
    "تصريح",
    "رخصة",
    "تأشيرة"
  ]
};
