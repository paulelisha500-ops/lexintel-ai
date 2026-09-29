/** Initial records for a new installation (the same records as backend/scripts/seed_data.py). */

export const SEED_CASES = [
  {
    "number": "TR-2026-90001",
    "type": "traffic",
    "status": "ready_for_hearing",
    "title": "Two-vehicle collision at Al Wasl Road junction",
    "description": "A rear-end collision was reported at 09:15 on 3 March 2026 near the Al Wasl Road junction in Dubai. The driver of the front vehicle reports neck pain and was examined at a clinic the same day. The driver of the rear vehicle states that the front vehicle braked suddenly for a pedestrian. Dashcam footage from a passing vehicle and the police accident report are on file. Repair estimates for the two vehicles differ and are disputed.",
    "signals": {
      "public_safety_flag": false,
      "vulnerable_victim": false,
      "missing_critical_evidence": false
    },
    "deadline_days": 40,
    "opened_days_ago": 60,
    "parties": [
      [
        "Rashid Al Ketbi",
        "plaintiff"
      ],
      [
        "Sanjay Mehta",
        "defendant"
      ],
      [
        "Fatima Al Hosani",
        "witness"
      ]
    ],
    "timeline": [
      [
        "2026-03-03",
        "Collision reported to traffic police at 09:15."
      ],
      [
        "2026-03-05",
        "Police accident report filed."
      ]
    ],
    "hearings": [
      [
        0,
        10,
        0,
        "Courtroom 4B",
        "Evidence hearing"
      ]
    ],
    "documents": [
      [
        "Police accident report",
        "police-report.txt",
        "Police accident report.\nReport dated 05/03/2026, incident on 03/03/2026 at 09:15 on Al Wasl Road, Dubai.\nThe rear vehicle struck the front vehicle while both were moving towards the junction.\nThe driver of the rear vehicle left the scene before officers arrived and returned after 40 minutes.\nDamage to the front vehicle was estimated at AED 4,500.\nThe front driver reported neck pain and was advised to attend a clinic.\nUnder Article 5 of the Traffic Law a driver must stop immediately after an accident.\n"
      ],
      [
        "Owner statement",
        "owner-statement.txt",
        "Statement of the vehicle owner, given on 12/03/2026.\nThe owner states the damage to the front vehicle was estimated at AED 6,000 by the workshop.\nThe owner says the collision happened at 09:40, not 09:15.\nThe owner asks the court to order payment of the repair cost and the medical expenses.\n"
      ]
    ]
  },
  {
    "number": "CY-2026-90002",
    "type": "cybercrime",
    "status": "under_investigation",
    "title": "Phishing messages impersonating a bank",
    "description": "Several residents received SMS messages linking to a fake banking page. One resident reported a loss of AED 12,500 on 14 April 2026 after entering her card details and a one-time password. The messages came from three different numbers over two weeks. The bank confirmed the page was not theirs and blocked the card. Screenshots of the messages and the transfer receipt are on file.",
    "signals": {
      "public_safety_flag": true,
      "vulnerable_victim": true,
      "missing_critical_evidence": true
    },
    "deadline_days": 9,
    "opened_days_ago": 120,
    "parties": [
      [
        "Aisha Al Zaabi",
        "victim"
      ]
    ],
    "timeline": [
      [
        "2026-04-14",
        "Victim transferred AED 12,500 after following an SMS link."
      ]
    ],
    "hearings": [
      [
        1,
        11,
        30,
        "Courtroom 2A",
        "Preliminary hearing"
      ]
    ],
    "documents": [
      [
        "Victim statement",
        "victim-statement.txt",
        "Statement of the complainant, 16/04/2026.\nOn 14/04/2026 I received a message saying my account was blocked and asking me to confirm my details.\nI opened the link and entered my card number and the code that arrived by SMS.\nWithin minutes AED 12,500 was transferred out of my account to an account I do not know.\nThe sender later threatened to publish my photos unless I paid more money.\n"
      ]
    ]
  },
  {
    "number": "CV-2026-90003",
    "type": "civil",
    "status": "in_hearing",
    "title": "Unpaid end-of-service gratuity",
    "description": "A former employee claims unpaid end-of-service gratuity and final salary after a fixed-term contract ended on 31 December 2025. The employee worked for the company for four years and eight months. The employer states that a payment was made in January 2026 and that the remaining amount is disputed. The employment contract, the final payslip and a bank statement are on file.",
    "signals": {
      "public_safety_flag": false,
      "vulnerable_victim": false,
      "missing_critical_evidence": false
    },
    "deadline_days": null,
    "opened_days_ago": 200,
    "parties": [
      [
        "Maria Santos",
        "plaintiff"
      ],
      [
        "Gulf Trading LLC",
        "defendant"
      ]
    ],
    "timeline": [
      [
        "2025-12-31",
        "Fixed-term contract ended."
      ]
    ],
    "hearings": [
      [
        0,
        13,
        0,
        "Courtroom 4B",
        "Main hearing"
      ],
      [
        7,
        9,
        30,
        "Courtroom 1C",
        "Continuation"
      ]
    ],
    "documents": [
      [
        "Employee claim letter",
        "claim-letter.txt",
        "Claim letter from the former employee, 15/01/2026.\nMy fixed-term contract ended on 31/12/2025 after four years and eight months of continuous service.\nI received my salary for December 2025 but no end-of-service gratuity.\nThe amount I claim is AED 34,000 in gratuity and AED 2,400 for unused leave.\nI asked the company in writing on 05/01/2026 and received no reply.\n"
      ],
      [
        "Employer reply",
        "employer-reply.txt",
        "Reply of the employer, 28/01/2026.\nThe company paid AED 12,000 to the employee on 20/01/2026 as part of the final settlement.\nThe company calculates the gratuity as AED 26,000 and not AED 34,000.\nThe company states the contract ended on 31/12/2025 by agreement of both parties.\n"
      ]
    ]
  },
  {
    "number": "CR-2026-90004",
    "type": "criminal",
    "status": "intake",
    "title": "Theft from a retail store",
    "description": "The manager of an electronics store reports the theft of three laptops and two phones on the evening of 12 September 2026. The stock value is given as AED 21,000. CCTV footage has been requested from the mall operator and is not yet on file. A store employee gave a short statement describing a man who left through the service corridor.",
    "signals": {
      "public_safety_flag": false,
      "vulnerable_victim": false,
      "missing_critical_evidence": true
    },
    "deadline_days": 25,
    "opened_days_ago": 5,
    "parties": [
      [
        "Ahmed Barakat",
        "witness"
      ]
    ],
    "timeline": [],
    "hearings": [],
    "documents": [
      [
        "Store manager report",
        "store-report.txt",
        "Report of the store manager, 13/09/2026.\nOn the evening of 12/09/2026 three laptops and two phones were taken from the display area.\nThe value of the stock taken is AED 21,000.\nAn employee saw a man put the items into a bag and leave through the service corridor.\nThe mall operator has been asked for the CCTV recording of that evening.\n"
      ]
    ]
  },
  {
    "number": "CR-2026-90005",
    "type": "criminal",
    "status": "under_investigation",
    "title": "Theft from a warehouse storage unit",
    "description": "A logistics company reports that electronics were taken from a storage unit overnight on 2 September 2026. The lock of the unit was cut and the stock value is given as AED 18,500. A security guard states he saw a van leave the yard at about 02:30. The unit's CCTV camera was not recording that night.",
    "signals": {
      "public_safety_flag": false,
      "vulnerable_victim": false,
      "missing_critical_evidence": true
    },
    "deadline_days": 30,
    "opened_days_ago": 16,
    "parties": [
      [
        "Nasser Al Marri",
        "witness"
      ]
    ],
    "timeline": [
      [
        "2026-09-02",
        "Storage unit found open; stock missing."
      ]
    ],
    "hearings": [],
    "documents": [
      [
        "Security guard statement",
        "guard-statement.txt",
        "Statement of the security guard, 03/09/2026.\nDuring the night shift on 02/09/2026 I saw a white van leave the yard at about 02:30.\nIn the morning the lock of storage unit 14 was cut and boxes of electronics were missing.\nThe value of the missing stock is given by the company as AED 18,500.\nThe camera covering that unit was not recording that night.\n"
      ]
    ]
  }
] as const;

export const SEED_COMPLAINTS = [
  [
    "cybercrime",
    "I received a WhatsApp message saying my bank account was blocked and asking for my OTP. After I replied, AED 3,200 was taken from my card.",
    "Dubai"
  ],
  [
    "civil",
    "My landlord has not returned my AED 8,000 security deposit two months after I moved out, even though the apartment was inspected and signed off.",
    "Sharjah"
  ],
  [
    "grievance",
    "Construction noise next to our building continues after midnight almost every day and the site does not respond to calls.",
    "Abu Dhabi"
  ]
] as const;

export const SEED_LAWS = [
  {
    "title": "Employment Relations Law — sample text",
    "filename": "employment-relations-law-en.txt",
    "language": "en",
    "jurisdiction": "federal",
    "law_number": null,
    "year": 2022,
    "effective_from": "2022-02-02",
    "text": "SAMPLE TEXT FOR THE LEXINTEL LAW LIBRARY. NOT OFFICIAL LEGISLATION. Upload the official text from the government portal for real research.\n\nArticle (1)\nEither party to an employment contract may end it for a legitimate reason, provided that the other party is\nnotified in writing not less than thirty days and not more than ninety days before the date of termination.\n\nArticle (2)\nA worker who completes one year of continuous service is entitled to an end-of-service gratuity calculated on\nthe basic wage last received.\n\nArticle (3)\nWhere an employer ends a contract without giving the notice required by Article (1), the worker is entitled to\ncompensation equal to the wage for the notice period that was not given.\n\nArticle (4)\nWages are due on the date agreed in the contract, and in any case within fifteen days of the end of the period\nfor which they are payable. A dispute over wages may be brought before the competent court.\n\nArticle (5)\nThe employer shall keep a record of each worker's leave, wages and end-of-service entitlements, and shall\nproduce that record when the court requires it.\n"
  },
  {
    "title": "قانون علاقات العمل — نص نموذجي",
    "filename": "employment-relations-law-ar.txt",
    "language": "ar",
    "jurisdiction": "federal",
    "law_number": null,
    "year": 2022,
    "effective_from": "2022-02-02",
    "text": "نص نموذجي لمكتبة القوانين في LexIntel، وليس تشريعاً رسمياً. ارفع النص الرسمي من البوابة الحكومية للبحث الفعلي.\n\nالمادة (1)\nيجوز لأي من طرفي عقد العمل إنهاؤه لسبب مشروع، على أن يُخطر الطرف الآخر كتابياً قبل مدة لا تقل عن ثلاثين يوماً\nولا تزيد على تسعين يوماً من تاريخ الإنهاء.\n\nالمادة (2)\nيستحق العامل الذي أكمل سنة من الخدمة المتصلة مكافأة نهاية الخدمة محسوبة على أساس آخر أجر أساسي تقاضاه.\n\nالمادة (3)\nإذا أنهى صاحب العمل العقد دون الإخطار المنصوص عليه في المادة (1)، استحق العامل تعويضاً يعادل أجر مدة الإخطار\nالتي لم تُمنح له.\n\nالمادة (4)\nتُستحق الأجور في التاريخ المتفق عليه في العقد، وبما لا يتجاوز خمسة عشر يوماً من نهاية المدة المستحقة عنها،\nويجوز رفع النزاع على الأجر إلى المحكمة المختصة.\n\nالمادة (5)\nيحتفظ صاحب العمل بسجل لإجازات كل عامل وأجوره ومستحقات نهاية خدمته، ويقدّمه عند طلب المحكمة.\n"
  },
  {
    "title": "Road Traffic Law — sample text",
    "filename": "road-traffic-law-en.txt",
    "language": "en",
    "jurisdiction": "federal",
    "law_number": null,
    "year": 2023,
    "effective_from": "2023-01-01",
    "text": "SAMPLE TEXT FOR THE LEXINTEL LAW LIBRARY. NOT OFFICIAL LEGISLATION. Upload the official text from the government portal for real research.\n\nArticle (1)\nA driver shall keep a sufficient distance from the vehicle ahead to allow the vehicle to be stopped safely if\nthe vehicle ahead brakes suddenly.\n\nArticle (2)\nA driver involved in an accident that causes injury shall stop at the scene, report the accident without delay\nand remain until the competent authority arrives.\n\nArticle (3)\nWhere an accident causes damage only, the drivers shall move their vehicles clear of the carriageway before\nexchanging particulars, unless an injury has occurred.\n\nArticle (4)\nThe court may rely on a police accident report, and on recordings from cameras fitted to vehicles or to the\nroad, in establishing how an accident occurred.\n"
  }
] as const;
