"""
The relationship graph against a REAL Neo4j server (docker compose service
`neo4j`). Uses throwaway ids and deletes everything it creates. Skips (exit 0
with a message) if Neo4j isn't reachable, so it never blocks other tests.
"""
import sys
sys.path.insert(0, ".")

from uuid import uuid4

from app.db.neo4j_repository import CaseGraphRepository, get_driver, neo4j_probe

if not neo4j_probe.available():
    print(f"SKIPPED: Neo4j not reachable ({neo4j_probe.status().get('error')})")
    raise SystemExit(0)

driver = get_driver()
repo = CaseGraphRepository(driver)
p1, p2, c1, c2, c3 = (uuid4() for _ in range(5))
citation = f"TEST-LAW-{uuid4().hex[:8]} | Art. 5"
try:
    repo.link_person_to_case(p1, c1, "witness", "Test Person One", "T-1")
    repo.link_person_to_case(p1, c2, "defendant", "Test Person One", "T-2")
    repo.link_person_to_case(p2, c1, "plaintiff", "Test Person Two", "T-1")
    repo.link_person_to_case(p1, c1, "witness")  # idempotent MERGE
    repo.link_case_to_citation(c1, citation, "2026-09-01")
    repo.link_case_to_citation(c3, citation, "2026-09-02")

    related = repo.related_cases_for_person(p1)
    assert {r["case_id"] for r in related} == {str(c1), str(c2)}, related
    co = repo.co_parties(c1)
    assert co == [{"person_id": str(p1), "other_case_id": str(c2), "role": "defendant"}], co
    shared = repo.cases_sharing_citations(c1)
    assert shared == [{"other_case_id": str(c3), "citations": [citation]}], shared
    assert set(repo.cases_citing(citation)) == {str(c1), str(c3)}
    repo.unlink_person_from_case(p1, c2)
    assert repo.co_parties(c1) == []
    print("ALL LIVE NEO4J CHECKS PASSED (real Cypher execution).")
finally:
    driver.execute_query(
        "MATCH (n) WHERE n.id IN $ids OR n.citation = $citation DETACH DELETE n",
        ids=[str(x) for x in (p1, p2, c1, c2, c3)], citation=citation, database_=None,
    )
