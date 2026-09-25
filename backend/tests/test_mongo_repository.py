import sys
sys.path.insert(0, ".")

from uuid import uuid4
import mongomock

from app.db.mongo_repository import SessionRepository, StatementRepository
from app.models.schemas import CourtroomSession, StatementRecord, HearingRole, IdentityVerificationStatus

client = mongomock.MongoClient()
db = client["lexintel_test"]

hearing_id = uuid4()
session = CourtroomSession(hearing_id=hearing_id, camera_device_id="stand-cam-01")

print("1. SessionRepository upsert + get...")
SessionRepository(db).upsert(session)
fetched = SessionRepository(db).get(str(session.id))
assert fetched is not None
assert fetched.hearing_id == hearing_id
assert fetched.camera_device_id == "stand-cam-01"
print("   OK")

print("2. StatementRepository upsert + get + list_for_hearing, ordering by sequence...")
s1 = StatementRecord(hearing_id=hearing_id, person_id=uuid4(), role=HearingRole.WITNESS,
                      sequence_number=2, transcript="Second witness statement.")
s2 = StatementRecord(hearing_id=hearing_id, person_id=uuid4(), role=HearingRole.DEFENDANT,
                      sequence_number=1, transcript="Defendant statement.",
                      identity_verification=IdentityVerificationStatus.VERIFIED)
StatementRepository(db).upsert(s1)
StatementRepository(db).upsert(s2)

fetched_s2 = StatementRepository(db).get(str(s2.id))
assert fetched_s2.transcript == "Defendant statement."
assert fetched_s2.identity_verification == IdentityVerificationStatus.VERIFIED

ordered = StatementRepository(db).list_for_hearing(str(hearing_id))
assert [s.sequence_number for s in ordered] == [1, 2], f"got {[s.sequence_number for s in ordered]}"
assert ordered[0].role == HearingRole.DEFENDANT
print("   OK - statements ordered by sequence_number, not insertion order")

print("\nALL MONGO-LAYER CHECKS PASSED (against mongomock; same code path as real pymongo).")
