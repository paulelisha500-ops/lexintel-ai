"""
Seed demo accounts and clearly-fictional demo records so every screen has
something real to work with in a development environment -- including the
local AI: the demo documents are processed exactly like uploaded evidence,
so case briefs, key sentences, offence mentions, cited laws, source
comparison and similar cases all have material.

It also seeds three short sample law texts so the Law Library and Legal
research work out of the box. Those were written for the demo and say so on
their first line; they are not UAE legislation, and every title starts with
"Demo:" so a cited article can't be mistaken for a real one.

Idempotent: accounts are created only if the username doesn't exist, cases
only if the demo case number doesn't exist, documents only if that label
isn't on the case yet, laws only if that title isn't in the library.
`--refresh` also rewrites demo case descriptions, adds any missing demo
documents to cases seeded by an older version, and moves the demo hearings
back to their offsets from today -- without that, the day after seeding the
Courtroom stand has no session to open.
Never run against a production database.

Usage (inside the backend container):
    python -m scripts.seed_demo --password 'YourDevPassword1'
    python -m scripts.seed_demo --password 'YourDevPassword1' --refresh
"""

from __future__ import annotations

import os

# Borrow the running API's embedding model instead of loading a second ~500 MB
# copy into this process (falls back to a local copy if the API is down).
os.environ.setdefault("EMBEDDINGS_URL", "http://localhost:8005/api/v1/internal/embed")

import argparse  # noqa: E402
import hashlib  # noqa: E402
import uuid  # noqa: E402
from datetime import date, datetime, timedelta, timezone  # noqa: E402
from pathlib import Path  # noqa: E402

from app.agents.prioritization_agent import score_case  # noqa: E402
from app.core.security import hash_password, hash_tracking_code, password_problems  # noqa: E402
from app.core.storage import delete_file, upload_root  # noqa: E402
from app.db.base import get_session, init_db  # noqa: E402
from app.db.postgres_repository import (  # noqa: E402
    CaseRepository, ComplaintRepository, EvidenceRepository, HearingRepository, LawDocumentRepository,
    PersonRepository, UserRepository,
)
from app.db.search import delete_doc  # noqa: E402
from app.models.auth_models import SystemRole  # noqa: E402
from app.models.schemas import (  # noqa: E402
    Case, CaseStatus, CaseType, Complaint, ComplaintStatus, Evidence, EvidenceType, Hearing, HearingRole,
    LawDocument, Person, TimelineEvent,
)
from app.services.indexing import index_case  # noqa: E402
from app.tasks import ingest_law_document_job, process_evidence_job  # noqa: E402

UAE = timezone(timedelta(hours=4))

ACCOUNTS = [
    ("admin", "System Administrator", SystemRole.ADMIN),
    ("judge.demo", "Judge Mariam Al Nuaimi (demo)", SystemRole.JUDGE),
    ("judge2.demo", "Judge Khalid Al Suwaidi (demo)", SystemRole.JUDGE),
    ("clerk.demo", "Hessa Al Mazrouei, Court Clerk (demo)", SystemRole.CLERK),
    ("officer.demo", "Omar Haddad, Case Officer (demo)", SystemRole.CASE_OFFICER),
    ("prosecutor.demo", "Layla Farouk, Prosecutor (demo)", SystemRole.PROSECUTOR),
]

CASES = [
    {
        "number": "TR-2026-90001", "type": CaseType.TRAFFIC, "status": CaseStatus.READY_FOR_HEARING,
        "title": "Demo: Two-vehicle collision at Al Wasl Road junction",
        "description": "(DEMO RECORD) A rear-end collision was reported at 09:15 on 3 March 2026 near the Al Wasl Road "
                       "junction in Dubai. The driver of the front vehicle reports neck pain and was examined at a clinic "
                       "the same day. The driver of the rear vehicle states that the front vehicle braked suddenly for a "
                       "pedestrian. Dashcam footage from a passing vehicle and the police accident report are on file. "
                       "Repair estimates for the two vehicles differ and are disputed.",
        "signals": {"public_safety_flag": False, "vulnerable_victim": False, "missing_critical_evidence": False},
        "deadline_days": 40, "opened_days_ago": 60,
        "parties": [("Rashid Al Ketbi (demo)", HearingRole.PLAINTIFF), ("Sanjay Mehta (demo)", HearingRole.DEFENDANT),
                    ("Fatima Al Hosani (demo)", HearingRole.WITNESS)],
        "timeline": [(date(2026, 3, 3), "Collision reported to traffic police at 09:15."),
                     (date(2026, 3, 5), "Police accident report filed.")],
        "hearings": [(0, 10, 0, "Courtroom 4B", "Evidence hearing")],
        "documents": [
            ("Police accident report", "police-report.txt",
             "(DEMO DOCUMENT) Police accident report.\n"
             "Report dated 05/03/2026, incident on 03/03/2026 at 09:15 on Al Wasl Road, Dubai.\n"
             "The rear vehicle struck the front vehicle while both were moving towards the junction.\n"
             "The driver of the rear vehicle left the scene before officers arrived and returned after 40 minutes.\n"
             "Damage to the front vehicle was estimated at AED 4,500.\n"
             "The front driver reported neck pain and was advised to attend a clinic.\n"
             "Under Article 5 of the Traffic Law a driver must stop immediately after an accident.\n"),
            ("Owner statement", "owner-statement.txt",
             "(DEMO DOCUMENT) Statement of the vehicle owner, given on 12/03/2026.\n"
             "The owner states the damage to the front vehicle was estimated at AED 6,000 by the workshop.\n"
             "The owner says the collision happened at 09:40, not 09:15.\n"
             "The owner asks the court to order payment of the repair cost and the medical expenses.\n"),
        ],
    },
    {
        "number": "CY-2026-90002", "type": CaseType.CYBERCRIME, "status": CaseStatus.UNDER_INVESTIGATION,
        "title": "Demo: Phishing messages impersonating a bank",
        "description": "(DEMO RECORD) Several residents received SMS messages linking to a fake banking page. One resident "
                       "reported a loss of AED 12,500 on 14 April 2026 after entering her card details and a one-time "
                       "password. The messages came from three different numbers over two weeks. The bank confirmed the "
                       "page was not theirs and blocked the card. Screenshots of the messages and the transfer receipt "
                       "are on file.",
        "signals": {"public_safety_flag": True, "vulnerable_victim": True, "missing_critical_evidence": True},
        "deadline_days": 9, "opened_days_ago": 120,
        "parties": [("Aisha Al Zaabi (demo)", HearingRole.VICTIM)],
        "timeline": [(date(2026, 4, 14), "Victim transferred AED 12,500 after following an SMS link.")],
        "hearings": [(1, 11, 30, "Courtroom 2A", "Preliminary hearing")],
        "documents": [
            ("Victim statement", "victim-statement.txt",
             "(DEMO DOCUMENT) Statement of the complainant, 16/04/2026.\n"
             "On 14/04/2026 I received a message saying my account was blocked and asking me to confirm my details.\n"
             "I opened the link and entered my card number and the code that arrived by SMS.\n"
             "Within minutes AED 12,500 was transferred out of my account to an account I do not know.\n"
             "The sender later threatened to publish my photos unless I paid more money.\n"),
        ],
    },
    {
        "number": "CV-2026-90003", "type": CaseType.CIVIL, "status": CaseStatus.IN_HEARING,
        "title": "Demo: Unpaid end-of-service gratuity",
        "description": "(DEMO RECORD) A former employee claims unpaid end-of-service gratuity and final salary after a "
                       "fixed-term contract ended on 31 December 2025. The employee worked for the company for four years "
                       "and eight months. The employer states that a payment was made in January 2026 and that the "
                       "remaining amount is disputed. The employment contract, the final payslip and a bank statement "
                       "are on file.",
        "signals": {"public_safety_flag": False, "vulnerable_victim": False, "missing_critical_evidence": False},
        "deadline_days": None, "opened_days_ago": 200,
        "parties": [("Maria Santos (demo)", HearingRole.PLAINTIFF), ("Gulf Trading LLC (demo)", HearingRole.DEFENDANT)],
        "timeline": [(date(2025, 12, 31), "Fixed-term contract ended.")],
        "hearings": [(0, 13, 0, "Courtroom 4B", "Main hearing"), (7, 9, 30, "Courtroom 1C", "Continuation")],
        "documents": [
            ("Employee claim letter", "claim-letter.txt",
             "(DEMO DOCUMENT) Claim letter from the former employee, 15/01/2026.\n"
             "My fixed-term contract ended on 31/12/2025 after four years and eight months of continuous service.\n"
             "I received my salary for December 2025 but no end-of-service gratuity.\n"
             "The amount I claim is AED 34,000 in gratuity and AED 2,400 for unused leave.\n"
             "I asked the company in writing on 05/01/2026 and received no reply.\n"),
            ("Employer reply", "employer-reply.txt",
             "(DEMO DOCUMENT) Reply of the employer, 28/01/2026.\n"
             "The company paid AED 12,000 to the employee on 20/01/2026 as part of the final settlement.\n"
             "The company calculates the gratuity as AED 26,000 and not AED 34,000.\n"
             "The company states the contract ended on 31/12/2025 by agreement of both parties.\n"),
        ],
    },
    {
        "number": "CR-2026-90004", "type": CaseType.CRIMINAL, "status": CaseStatus.INTAKE,
        "title": "Demo: Theft from a retail store",
        "description": "(DEMO RECORD) The manager of an electronics store reports the theft of three laptops and two "
                       "phones on the evening of 12 September 2026. The stock value is given as AED 21,000. CCTV footage "
                       "has been requested from the mall operator and is not yet on file. A store employee gave a short "
                       "statement describing a man who left through the service corridor.",
        "signals": {"public_safety_flag": False, "vulnerable_victim": False, "missing_critical_evidence": True},
        "deadline_days": 25, "opened_days_ago": 5,
        "parties": [("Ahmed Barakat (demo)", HearingRole.WITNESS)],
        "timeline": [],
        "hearings": [],
        "documents": [
            ("Store manager report", "store-report.txt",
             "(DEMO DOCUMENT) Report of the store manager, 13/09/2026.\n"
             "On the evening of 12/09/2026 three laptops and two phones were taken from the display area.\n"
             "The value of the stock taken is AED 21,000.\n"
             "An employee saw a man put the items into a bag and leave through the service corridor.\n"
             "The mall operator has been asked for the CCTV recording of that evening.\n"),
        ],
    },
    {
        "number": "CR-2026-90005", "type": CaseType.CRIMINAL, "status": CaseStatus.UNDER_INVESTIGATION,
        "title": "Demo: Theft from a warehouse storage unit",
        "description": "(DEMO RECORD) A logistics company reports that electronics were taken from a storage unit "
                       "overnight on 2 September 2026. The lock of the unit was cut and the stock value is given as "
                       "AED 18,500. A security guard states he saw a van leave the yard at about 02:30. The unit's "
                       "CCTV camera was not recording that night.",
        "signals": {"public_safety_flag": False, "vulnerable_victim": False, "missing_critical_evidence": True},
        "deadline_days": 30, "opened_days_ago": 16,
        "parties": [("Nasser Al Marri (demo)", HearingRole.WITNESS)],
        "timeline": [(date(2026, 9, 2), "Storage unit found open; stock missing.")],
        "hearings": [],
        "documents": [
            ("Security guard statement", "guard-statement.txt",
             "(DEMO DOCUMENT) Statement of the security guard, 03/09/2026.\n"
             "During the night shift on 02/09/2026 I saw a white van leave the yard at about 02:30.\n"
             "In the morning the lock of storage unit 14 was cut and boxes of electronics were missing.\n"
             "The value of the missing stock is given by the company as AED 18,500.\n"
             "The camera covering that unit was not recording that night.\n"),
        ],
    },
]

COMPLAINTS = [
    (CaseType.CYBERCRIME, "I received a WhatsApp message saying my bank account was blocked and asking for my OTP. "
                          "After I replied, AED 3,200 was taken from my card. (demo complaint)", "Dubai"),
    (CaseType.CIVIL, "My landlord has not returned my AED 8,000 security deposit two months after I moved out, "
                     "even though the apartment was inspected and signed off. (demo complaint)", "Sharjah"),
    (CaseType.GRIEVANCE, "Construction noise next to our building continues after midnight almost every day "
                         "and the site does not respond to calls. (demo complaint)", "Abu Dhabi"),
]


# Sample law texts, so the library and legal research have something to work on
# out of the box. These were WRITTEN FOR THE DEMO: they are not UAE legislation
# and no official text is reproduced. Each file says so on its first line and
# each title starts with "Demo:", so an article cited in a research answer can
# never be mistaken for a real one. A real deployment uploads the official PDFs
# from the government portal instead.
LAWS = [
    {
        "title": "Demo: Sample Employment Relations Law",
        "filename": "demo-employment-relations-law-en.txt",
        "language": "en", "jurisdiction": "federal", "law_number": "D-1", "year": 2022,
        "effective_from": date(2022, 2, 2),
        "text": """SAMPLE TEXT WRITTEN FOR THE LEXINTEL DEMO. NOT REAL LEGISLATION.

Article (1)
Either party to an employment contract may end it for a legitimate reason, provided that the other party is
notified in writing not less than thirty days and not more than ninety days before the date of termination.

Article (2)
A worker who completes one year of continuous service is entitled to an end-of-service gratuity calculated on
the basic wage last received.

Article (3)
Where an employer ends a contract without giving the notice required by Article (1), the worker is entitled to
compensation equal to the wage for the notice period that was not given.

Article (4)
Wages are due on the date agreed in the contract, and in any case within fifteen days of the end of the period
for which they are payable. A dispute over wages may be brought before the competent court.

Article (5)
The employer shall keep a record of each worker's leave, wages and end-of-service entitlements, and shall
produce that record when the court requires it.
""",
    },
    {
        "title": "Demo: Sample Employment Relations Law (Arabic)",
        "filename": "demo-employment-relations-law-ar.txt",
        "language": "ar", "jurisdiction": "federal", "law_number": "D-1", "year": 2022,
        "effective_from": date(2022, 2, 2),
        "text": """نص تجريبي كُتب لعرض نظام LexIntel، وهو ليس تشريعاً رسمياً.

المادة (1)
يجوز لأي من طرفي عقد العمل إنهاؤه لسبب مشروع، على أن يُخطر الطرف الآخر كتابياً قبل مدة لا تقل عن ثلاثين يوماً
ولا تزيد على تسعين يوماً من تاريخ الإنهاء.

المادة (2)
يستحق العامل الذي أكمل سنة من الخدمة المتصلة مكافأة نهاية الخدمة محسوبة على أساس آخر أجر أساسي تقاضاه.

المادة (3)
إذا أنهى صاحب العمل العقد دون الإخطار المنصوص عليه في المادة (1)، استحق العامل تعويضاً يعادل أجر مدة الإخطار
التي لم تُمنح له.

المادة (4)
تُستحق الأجور في التاريخ المتفق عليه في العقد، وبما لا يتجاوز خمسة عشر يوماً من نهاية المدة المستحقة عنها،
ويجوز رفع النزاع على الأجر إلى المحكمة المختصة.

المادة (5)
يحتفظ صاحب العمل بسجل لإجازات كل عامل وأجوره ومستحقات نهاية خدمته، ويقدّمه عند طلب المحكمة.
""",
    },
    {
        "title": "Demo: Sample Road Traffic Law",
        "filename": "demo-road-traffic-law-en.txt",
        "language": "en", "jurisdiction": "federal", "law_number": "D-2", "year": 2023,
        "effective_from": date(2023, 1, 1),
        "text": """SAMPLE TEXT WRITTEN FOR THE LEXINTEL DEMO. NOT REAL LEGISLATION.

Article (1)
A driver shall keep a sufficient distance from the vehicle ahead to allow the vehicle to be stopped safely if
the vehicle ahead brakes suddenly.

Article (2)
A driver involved in an accident that causes injury shall stop at the scene, report the accident without delay
and remain until the competent authority arrives.

Article (3)
Where an accident causes damage only, the drivers shall move their vehicles clear of the carriageway before
exchanging particulars, unless an injury has occurred.

Article (4)
The court may rely on a police accident report, and on recordings from cameras fitted to vehicles or to the
road, in establishing how an accident occurred.
""",
    },
]


def _add_laws(db, uploaded_by) -> list[str]:
    """Create any sample law document that isn't in the library yet."""
    repo = LawDocumentRepository(db)
    present = {d.title for d in repo.list_all()}
    created = []
    for spec in LAWS:
        if spec["title"] in present:
            continue
        path, sha, size = _store_demo_file(spec["filename"], spec["text"], folder="library")
        doc = repo.create(LawDocument(
            title=spec["title"], law_number=spec["law_number"], year=spec["year"],
            jurisdiction=spec["jurisdiction"], language=spec["language"],
            effective_from=spec["effective_from"], legislation_state="active",
            original_filename=spec["filename"], sha256=sha, size_bytes=size, uploaded_by=uploaded_by,
        ), path)
        created.append(str(doc.id))
    return created


def _reschedule_hearings(db, case_id, specs: list[tuple], now: datetime) -> None:
    """Move this case's demo hearings back to their offsets from today.

    Hearings are seeded relative to the day the seed ran, so the day after
    seeding the courtroom screen has nothing to open and the stand can't be
    demonstrated. A refresh re-anchors them, matched by courtroom and type so
    each hearing keeps the slot it was written for."""
    repo = HearingRepository(db)
    existing = repo.list_for_case(case_id)
    for day_offset, hour, minute, room, kind in specs:
        match = next((h for h in existing if h.courtroom == room and h.hearing_type == kind), None)
        if not match:
            continue
        at = datetime.combine((now + timedelta(days=day_offset)).date(), datetime.min.time(), tzinfo=UAE)
        repo.update(match.id, scheduled_at=at.replace(hour=hour, minute=minute))


def _store_demo_file(filename: str, text: str, folder: str = "evidence") -> tuple[str, str, int]:
    """Write a demo document where uploads live. Returns (path, sha256, size)."""
    folder = upload_root() / folder
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{uuid.uuid4().hex}-{filename}"
    data = text.encode("utf-8")
    path.write_bytes(data)
    return str(path), hashlib.sha256(data).hexdigest(), len(data)


def _add_documents(db, case, documents: list[tuple[str, str, str]], uploaded_by, replace: bool = False) -> list[str]:
    """Create evidence rows for the demo documents. With `replace`, existing demo
    documents of the same label are removed first (their text may have changed)."""
    repo = EvidenceRepository(db)
    existing = {e.label: e for e in repo.list_for_case(case.id)}
    new_ids = []
    for label, filename, text in documents:
        old = existing.get(label)
        if old is not None:
            if not replace:
                continue
            row = repo.row(old.id)
            delete_file(row.storage_path if row else None)
            delete_doc("evidence", old.id)
            db.delete(row)
            db.flush()
        path, sha, size = _store_demo_file(filename, text)
        evidence = repo.create(Evidence(
            case_id=case.id, label=label, evidence_type=EvidenceType.DOCUMENT, original_filename=filename,
            content_type="text/plain", size_bytes=size, sha256=sha, uploaded_by=uploaded_by,
        ), path)
        new_ids.append(str(evidence.id))
    return new_ids


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed LexIntel demo data (development only).")
    parser.add_argument("--password", default=os.environ.get("DEMO_PASSWORD"),
                        help="Password for all demo accounts (or set DEMO_PASSWORD).")
    parser.add_argument("--refresh", action="store_true",
                        help="Also update demo case descriptions and add missing demo documents.")
    args = parser.parse_args()
    if not args.password or password_problems(args.password):
        raise SystemExit("Provide --password with at least 10 characters including letters and numbers.")

    init_db()
    now = datetime.now(UAE)
    evidence_to_process: list[str] = []
    with get_session() as db:
        users = UserRepository(db)
        created_users = []
        for username, name, role in ACCOUNTS:
            if not users.get_by_username(username):
                users.create(username, hash_password(args.password), name, role)
                created_users.append(username)
        judge = users.get_by_username("judge.demo")
        judge2 = users.get_by_username("judge2.demo")
        officer = users.get_by_username("officer.demo") or judge

        cases, people, hearings = CaseRepository(db), PersonRepository(db), HearingRepository(db)
        created_cases, refreshed_cases = [], []
        for spec in CASES:
            existing = cases.get_by_number(spec["number"])
            if existing:
                if args.refresh:
                    updated = cases.update(existing.id, description=spec["description"])
                    added = _add_documents(db, existing, spec.get("documents", []), officer.id, replace=True)
                    evidence_to_process.extend(added)
                    index_case(updated or existing, [p.person.full_name for p in cases.parties(existing.id)])
                    _reschedule_hearings(db, existing.id, spec["hearings"], now)
                    refreshed_cases.append(spec["number"])
                continue
            opened = now - timedelta(days=spec["opened_days_ago"])
            deadline = (now + timedelta(days=spec["deadline_days"])).date() if spec["deadline_days"] else None
            case = cases.create(Case(
                case_number=spec["number"], case_type=spec["type"], status=spec["status"], title=spec["title"],
                description=spec["description"], statutory_deadline=deadline, created_at=opened,
                assigned_judge_id=judge.id if judge else None,
            ))
            signals = {**spec["signals"], "case_id": str(case.id), "case_opened_on": opened.date().isoformat(),
                       "statutory_deadline": deadline.isoformat() if deadline else None}
            cases.update_priority(case.id, score_case(signals), signals)
            for name, role in spec["parties"]:
                person = people.create(Person(full_name=name, role_in_case=role))
                cases.add_party(case.id, person.id, role.value)
            if spec["timeline"]:
                cases.add_timeline_events(case.id, [
                    TimelineEvent(case_id=case.id, event_date=d, description=text, entity_type="manual",
                                  source_label="Demo seed") for d, text in spec["timeline"]])
            for day_offset, hour, minute, room, kind in spec["hearings"]:
                at = datetime.combine((now + timedelta(days=day_offset)).date(), datetime.min.time(), tzinfo=UAE)
                hearings.create(Hearing(case_id=case.id, scheduled_at=at.replace(hour=hour, minute=minute),
                                        courtroom=room, hearing_type=kind, duration_minutes=60,
                                        presiding_judge_id=(judge2.id if room == "Courtroom 2A" and judge2 else
                                                            judge.id if judge else None)))
            evidence_to_process.extend(_add_documents(db, case, spec.get("documents", []), officer.id))
            created_cases.append(spec["number"])

        laws_to_index = _add_laws(db, officer.id)

        complaints = ComplaintRepository(db)
        existing_texts = {c.description for c in complaints.list_all()}
        created_complaints = []
        for case_type, text, location in COMPLAINTS:
            if text in existing_texts:
                continue
            c = complaints.create(Complaint(submitted_by=uuid.uuid4(), case_type=case_type, description=text,
                                            location=location, status=ComplaintStatus.RECEIVED,
                                            complainant_name="Demo Citizen"),
                                  tracking_code_hash=hash_tracking_code("DEMO2026"))
            created_complaints.append(c.reference_number)

    # Outside the transaction: read the documents exactly as uploaded evidence is
    # read (text, entities, key sentences, offence mentions, cited laws, timeline).
    for evidence_id in evidence_to_process:
        process_evidence_job(evidence_id)
    for law_id in laws_to_index:
        ingest_law_document_job(law_id)

    print(f"accounts created: {created_users or 'none (already present)'}")
    print(f"cases created: {created_cases or 'none (already present)'}")
    if refreshed_cases:
        print(f"cases refreshed with demo documents: {refreshed_cases}")
    print(f"demo documents processed: {len(evidence_to_process)}")
    print(f"sample law texts indexed: {len(laws_to_index)} (demo text, not real legislation)")
    print(f"complaints created: {created_complaints or 'none (already present)'} (tracking code DEMO2026)")


if __name__ == "__main__":
    main()
