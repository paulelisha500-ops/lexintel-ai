"""Repository layer against a real Postgres (the lexintel_test database)."""
import tests._env as env  # noqa: F401  (must be first)

from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

env.reset_databases()

from app.core.security import create_access_token, decode_access_token, hash_password, verify_password  # noqa: E402
from app.db.base import get_session  # noqa: E402
from app.db.postgres_repository import (  # noqa: E402
    CaseRepository, ComplaintRepository, HearingRepository, PersonRepository, RulingRepository, UserRepository,
)
from app.models.auth_models import SystemRole  # noqa: E402
from app.models.schemas import (  # noqa: E402
    Case, CaseRuling, CaseType, Complaint, Hearing, HearingRole, HearingStatus, Person, PriorityAssessment,
    PriorityLevel, TimelineEvent,
)

print("security helpers")
h = hash_password("correct-horse-battery-staple1")
assert verify_password("correct-horse-battery-staple1", h) and not verify_password("wrong", h)
assert decode_access_token(create_access_token(str(uuid4()), "judge"))["role"] == "judge"

print("users")
with get_session() as db:
    judge = UserRepository(db).create("judge.repo", hash_password("pw123456789"), "Judge Repo", SystemRole.JUDGE)
with get_session() as db:
    assert UserRepository(db).get_by_username("JUDGE.REPO").id == judge.id  # case-insensitive

print("cases: auto number, priority, timeline dedupe, filters")
with get_session() as db:
    repo = CaseRepository(db)
    c1 = repo.create(Case(case_number="", case_type=CaseType.CRIMINAL, title="State v. Example"))
    c2 = repo.create(Case(case_number="", case_type=CaseType.CRIMINAL, title="State v. Other"))
    assert c1.case_number.startswith("CR-") and c1.case_number != c2.case_number
    repo.update_priority(c1.id, PriorityAssessment(case_id=c1.id, level=PriorityLevel.HIGH, score=0.8,
                                                   factors={"x": 0.8}, explanation="because"))
    events = [TimelineEvent(case_id=c1.id, description="Complaint filed", entity_type="event", event_date=date(2026, 6, 1))]
    repo.add_timeline_events(c1.id, events)
    repo.add_timeline_events(c1.id, events)  # duplicate ignored
    found, total = repo.search(status="intake", case_type="criminal", priority="high")
    assert total == 1 and found[0].id == c1.id
    assert len(repo.get(c1.id).timeline) == 1

print("people, parties, hearings, conflicts")
with get_session() as db:
    person = PersonRepository(db).create(Person(full_name="Fatima Al Nuaimi", role_in_case=HearingRole.WITNESS))
    CaseRepository(db).add_party(c1.id, person.id, "witness")
    assert CaseRepository(db).parties(c1.id)[0].role == "witness"
    start = datetime.now(timezone.utc) + timedelta(days=2)
    HearingRepository(db).create(Hearing(case_id=c1.id, scheduled_at=start, courtroom="4B", duration_minutes=60))
    assert HearingRepository(db).conflicts(start + timedelta(minutes=30), 30, "4B", None)
    assert not HearingRepository(db).conflicts(start + timedelta(minutes=61), 30, "4B", None)
    assert HearingRepository(db).search(status=HearingStatus.SCHEDULED.value)

print("complaints: unique references")
with get_session() as db:
    refs = {ComplaintRepository(db).create(Complaint(submitted_by=uuid4(), case_type=CaseType.CYBERCRIME,
                                                     description="Phishing attempt reported.")).reference_number for _ in range(5)}
    assert len(refs) == 5 and all(r.startswith("CMP-") for r in refs)

print("rulings: judge-only write path keeps entered_by")
with get_session() as db:
    RulingRepository(db).create(CaseRuling(case_id=c1.id, entered_by=judge.id, ruling_text="Dismissed."))
with get_session() as db:
    assert RulingRepository(db).get(c1.id).entered_by == judge.id

print("\nALL REPOSITORY CHECKS PASSED against the real Postgres test database.")
