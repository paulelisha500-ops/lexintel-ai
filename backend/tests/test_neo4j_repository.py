"""
Verifies the Cypher + parameters CaseGraphRepository builds, using a fake
driver that records calls instead of a real Neo4j connection (unreachable
from this sandbox -- see neo4j_repository.py's docstring). This proves the
query construction is correct; it does NOT prove Neo4j executes these
queries the way I expect. Run against `docker compose up neo4j` before
trusting this in production.
"""
import sys
sys.path.insert(0, ".")

from uuid import uuid4
from app.db.neo4j_repository import CaseGraphRepository


class FakeResult:
    def __init__(self, records):
        self.records = records


class FakeDriver:
    """Records every call; returns canned data queued via .queue_result()."""
    def __init__(self):
        self.calls = []
        self._queue = []

    def queue_result(self, records):
        self._queue.append(records)

    def execute_query(self, query, **kwargs):
        self.calls.append({"query": query, "params": kwargs})
        records = self._queue.pop(0) if self._queue else []
        return FakeResult(records)


driver = FakeDriver()
repo = CaseGraphRepository(driver)

person_id, case_id = uuid4(), uuid4()

print("1. link_person_to_case sends correct params...")
repo.link_person_to_case(person_id, case_id, "witness")
call = driver.calls[-1]
assert call["params"]["person_id"] == str(person_id)
assert call["params"]["case_id"] == str(case_id)
assert call["params"]["role"] == "witness"
assert "MERGE" in call["query"] and "INVOLVED_IN" in call["query"]
print("   OK")

print("2. link_case_to_citation sends correct params...")
repo.link_case_to_citation(case_id, "UAE-FED-LAW-2021-31-ART-5", "2026-07-01")
call = driver.calls[-1]
assert call["params"]["citation"] == "UAE-FED-LAW-2021-31-ART-5"
assert "LegalProvision" in call["query"]
print("   OK")

print("3. related_cases_for_person parses records correctly...")
driver.queue_result([{"case_id": "case-A", "role": "witness"}, {"case_id": "case-B", "role": "victim"}])
out = repo.related_cases_for_person(person_id)
assert out == [{"case_id": "case-A", "role": "witness"}, {"case_id": "case-B", "role": "victim"}]
print("   OK")

print("4. co_parties parses distinct-pair records correctly...")
driver.queue_result([{"person_id": "p2", "other_case_id": "case-Z", "role": "witness"}])
out = repo.co_parties(case_id)
assert out == [{"person_id": "p2", "other_case_id": "case-Z", "role": "witness"}]
print("   OK")

print("5. cases_citing returns a flat list of case ids...")
driver.queue_result([{"case_id": "case-A"}, {"case_id": "case-C"}])
out = repo.cases_citing("UAE-FED-LAW-2021-31-ART-5")
assert out == ["case-A", "case-C"]
print("   OK")

print("\nALL QUERY-BUILDING CHECKS PASSED against a mocked driver.")
print("NOT tested: actual Cypher execution semantics against real Neo4j.")
