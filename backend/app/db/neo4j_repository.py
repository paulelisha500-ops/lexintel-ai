"""
Neo4j relationship graph: Person -[INVOLVED_IN {role}]-> Case,
Case -[CITED]-> LegalProvision, Complaint -[OPENED_AS]-> Case.

Additive, never the source of truth (Postgres is). It answers the questions
relational joins get awkward for -- "every other case this person appears
in", "co-parties across filings", "which cases relied on this provision" --
and every call site has a Postgres fallback for when the graph is down.
Results are leads for a human to review, never conclusions.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from uuid import UUID

from app.core.config import get_settings
from app.core.resilience import Probe

log = logging.getLogger("lexintel.graph")
settings = get_settings()


@lru_cache
def get_driver():
    from neo4j import GraphDatabase

    return GraphDatabase.driver(
        settings.neo4j_url,
        auth=(settings.neo4j_user, settings.neo4j_password),
        connection_timeout=3,
        max_transaction_retry_time=5,
    )


def _check() -> None:
    if not settings.neo4j_enabled:
        raise RuntimeError("disabled by NEO4J_ENABLED=false")
    get_driver().verify_connectivity()


neo4j_probe = Probe("neo4j", _check)


class CaseGraphRepository:
    """Takes a neo4j.Driver so tests can pass a mocked one."""

    def __init__(self, driver):
        self.driver = driver

    def link_person_to_case(self, person_id: UUID, case_id: UUID, role: str, person_name: str | None = None,
                            case_number: str | None = None) -> None:
        self.driver.execute_query(
            """
            MERGE (p:Person {id: $person_id})
              SET p.name = coalesce($person_name, p.name)
            MERGE (c:Case {id: $case_id})
              SET c.case_number = coalesce($case_number, c.case_number)
            MERGE (p)-[r:INVOLVED_IN]->(c)
              SET r.role = $role
            """,
            person_id=str(person_id), case_id=str(case_id), role=role,
            person_name=person_name, case_number=case_number, database_=None,
        )

    def unlink_person_from_case(self, person_id: UUID, case_id: UUID) -> None:
        self.driver.execute_query(
            "MATCH (:Person {id: $person_id})-[r:INVOLVED_IN]->(:Case {id: $case_id}) DELETE r",
            person_id=str(person_id), case_id=str(case_id), database_=None,
        )

    def link_case_to_citation(self, case_id: UUID, citation: str, as_of_date: str) -> None:
        self.driver.execute_query(
            """
            MERGE (c:Case {id: $case_id})
            MERGE (l:LegalProvision {citation: $citation})
            MERGE (c)-[r:CITED]->(l)
            ON CREATE SET r.first_cited_at = $as_of_date
            SET r.as_of_date = $as_of_date
            """,
            case_id=str(case_id), citation=citation, as_of_date=as_of_date,
            database_=None,
        )

    def link_complaint_to_case(self, complaint_id: UUID, case_id: UUID) -> None:
        self.driver.execute_query(
            """
            MERGE (k:Complaint {id: $complaint_id})
            MERGE (c:Case {id: $case_id})
            MERGE (k)-[:OPENED_AS]->(c)
            """,
            complaint_id=str(complaint_id), case_id=str(case_id), database_=None,
        )

    def related_cases_for_person(self, person_id: UUID) -> list[dict]:
        result = self.driver.execute_query(
            """
            MATCH (p:Person {id: $person_id})-[r:INVOLVED_IN]->(c:Case)
            RETURN c.id AS case_id, r.role AS role
            """,
            person_id=str(person_id), database_=None,
        )
        return [{"case_id": rec["case_id"], "role": rec["role"]} for rec in result.records]

    def co_parties(self, case_id: UUID) -> list[dict]:
        result = self.driver.execute_query(
            """
            MATCH (:Case {id: $case_id})<-[:INVOLVED_IN]-(p:Person)
                  -[r:INVOLVED_IN]->(other:Case)
            WHERE other.id <> $case_id
            RETURN DISTINCT p.id AS person_id, other.id AS other_case_id, r.role AS role
            """,
            case_id=str(case_id), database_=None,
        )
        return [{"person_id": rec["person_id"], "other_case_id": rec["other_case_id"], "role": rec["role"]}
                for rec in result.records]

    def cases_sharing_citations(self, case_id: UUID) -> list[dict]:
        result = self.driver.execute_query(
            """
            MATCH (:Case {id: $case_id})-[:CITED]->(l:LegalProvision)<-[:CITED]-(other:Case)
            WHERE other.id <> $case_id
            RETURN other.id AS other_case_id, collect(DISTINCT l.citation)[0..5] AS citations
            """,
            case_id=str(case_id), database_=None,
        )
        return [{"other_case_id": rec["other_case_id"], "citations": rec["citations"]} for rec in result.records]

    def cases_citing(self, citation: str) -> list[str]:
        result = self.driver.execute_query(
            """
            MATCH (c:Case)-[:CITED]->(:LegalProvision {citation: $citation})
            RETURN DISTINCT c.id AS case_id
            """,
            citation=citation, database_=None,
        )
        return [rec["case_id"] for rec in result.records]


def graph() -> CaseGraphRepository | None:
    """The live repository, or None when Neo4j is unreachable (use the fallback)."""
    if not neo4j_probe.available():
        return None
    return CaseGraphRepository(get_driver())


def safe_graph_call(fn_name: str, *args, **kwargs):
    """Fire-and-forget sync into the graph. Never raises."""
    repo = graph()
    if repo is None:
        return None
    try:
        return getattr(repo, fn_name)(*args, **kwargs)
    except Exception as exc:
        log.warning("graph %s failed: %s", fn_name, exc)
        neo4j_probe.mark_down(exc)
        return None
