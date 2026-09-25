"""
Cases -- Modules 2 (case intelligence), 4 (prioritization), 5 (similar and
related cases), 10 (docket) and the judge-only ruling.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Annotated, Optional
from uuid import UUID

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import AfterValidator, BaseModel, Field
from sqlalchemy.orm import Session

from app.agents.case_intelligence_agent import compare_sources, run_case_intelligence
from app.agents.prioritization_agent import score_case
from app.ai.drafting import stream_grounded_draft
from app.api.deps import (
    CASE_BUILDERS, CASE_EDITORS, STAFF, audit, get_current_user, parse_uuid_or_404, require_role,
)
from app.api.streaming import event_stream, sse
from app.core.security import hash_emirates_id, normalize_emirates_id
from app.db import search
from app.db.base import get_db
from app.db.mongo_repository import EvidenceTextRepository, StatementRepository, get_mongo_db, mongo_probe
from app.db.neo4j_repository import graph, neo4j_probe, safe_graph_call
from app.db.postgres_repository import (
    AuditRepository, CaseRepository, EvidenceRepository, HearingRepository, PersonRepository,
    ResearchNoteRepository, RulingRepository, UserRepository,
)
from app.models.auth_models import SystemRole, UserAccount
from app.models.schemas import (
    Case, CaseRuling, CaseStatus, CaseType, HearingRole, Person, ResearchNote, TimelineEvent,
)
from app.services import case_brief
from app.services.indexing import index_case, index_person

router = APIRouter(tags=["cases"])
log = logging.getLogger("lexintel.cases")


def _case_or_404(db: Session, case_id: str) -> Case:
    case = CaseRepository(db).get(parse_uuid_or_404(case_id, "Case"))
    if not case:
        raise HTTPException(404, "Case not found.")
    return case


def _reindex(db: Session, case_id: UUID) -> None:
    repo = CaseRepository(db)
    case = repo.get(case_id)
    if case:
        index_case(case, [p.person.full_name for p in repo.parties(case_id)])


# ---------------------------------------------------------------------------
# Docket
# ---------------------------------------------------------------------------

@router.get("/cases")
def list_cases(
    status: Optional[CaseStatus] = None,
    case_type: Optional[CaseType] = None,
    priority: Optional[str] = Query(default=None, pattern=r"^(high|medium|low|unscored)$"),
    q: Optional[str] = Query(default=None, max_length=200),
    open_only: bool = False,
    mine: bool = False,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    repo = CaseRepository(db)
    judge_id = user.id if mine and user.role == SystemRole.JUDGE else None
    cases, total = repo.search(status=status, case_type=case_type, priority=priority, q=q, open_only=open_only,
                               judge_id=judge_id, limit=limit, offset=offset)
    extras = repo.counts_for([c.id for c in cases])
    items = []
    for c in cases:
        data = c.model_dump(mode="json", exclude={"timeline"})
        extra = extras.get(c.id, {})
        data.update(party_count=extra.get("party_count", 0), evidence_count=extra.get("evidence_count", 0),
                    next_hearing=extra["next_hearing"].isoformat() if extra.get("next_hearing") else None,
                    timeline_count=len(c.timeline))
        items.append(data)
    return {"items": items, "total": total}


def _plausible_deadline(v: date | None) -> date | None:
    # A date field accepts any calendar date, including 0001-01-01 and 9999-12-31,
    # which are typos rather than deadlines. An overdue deadline is legitimate
    # (that is what the priority score is for), so the window is wide.
    if v is not None and not (date(2000, 1, 1) <= v <= date(2100, 12, 31)):
        raise ValueError("The deadline must be a date between 2000 and 2100.")
    return v


Deadline = Annotated[Optional[date], AfterValidator(_plausible_deadline)]


class CaseCreate(BaseModel):
    case_number: Optional[str] = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9\-/]*$")
    case_type: CaseType
    title: str = Field(min_length=4, max_length=500)
    description: Optional[str] = Field(default=None, max_length=20000)
    statutory_deadline: Deadline = None
    assigned_judge_id: Optional[UUID] = None
    public_safety_flag: bool = False
    vulnerable_victim: bool = False
    missing_critical_evidence: bool = False


@router.post("/cases", status_code=201)
def create_case(payload: CaseCreate, request: Request, db: Session = Depends(get_db),
                user: UserAccount = Depends(require_role(*CASE_BUILDERS))):
    repo = CaseRepository(db)
    if payload.case_number and repo.get_by_number(payload.case_number.strip()):
        raise HTTPException(409, "A case with that case number already exists.")
    case = repo.create(Case(
        case_number=(payload.case_number or "").strip(), case_type=payload.case_type, title=payload.title.strip(),
        description=payload.description, statutory_deadline=payload.statutory_deadline,
        assigned_judge_id=payload.assigned_judge_id,
    ))
    signals = {
        "case_id": str(case.id), "case_opened_on": date.today().isoformat(),
        "statutory_deadline": payload.statutory_deadline.isoformat() if payload.statutory_deadline else None,
        "public_safety_flag": payload.public_safety_flag, "vulnerable_victim": payload.vulnerable_victim,
        "missing_critical_evidence": payload.missing_critical_evidence,
    }
    case = repo.update_priority(case.id, score_case(signals), signals)
    audit(db, request, user, "case.created", "case", case.id, {"case_number": case.case_number})
    db.commit()
    index_case(case)
    return case.model_dump(mode="json")


@router.get("/cases/{case_id}")
def get_case(case_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    case = _case_or_404(db, case_id)
    repo = CaseRepository(db)
    judge = UserRepository(db).get(case.assigned_judge_id) if case.assigned_judge_id else None
    ruling = RulingRepository(db).get(case.id)
    evidence = EvidenceRepository(db).list_for_case(case.id)
    statements_count = None
    if mongo_probe.available():
        try:
            statements_count = len(StatementRepository(get_mongo_db()).list_for_case(str(case.id)))
        except Exception as exc:
            mongo_probe.mark_down(exc)
    data = case.model_dump(mode="json")
    data.update(
        parties=[p.model_dump(mode="json") for p in repo.parties(case.id)],
        hearings=[h.model_dump(mode="json") for h in HearingRepository(db).list_for_case(case.id)],
        evidence_summary={
            "total": len(evidence),
            "pending_review": sum(1 for e in evidence if e.review_status == "pending_review"),
            "processing": sum(1 for e in evidence if e.processing_status in ("queued", "processing")),
        },
        ruling=ruling.model_dump(mode="json") if ruling else None,
        assigned_judge={"id": str(judge.id), "full_name": judge.full_name} if judge else None,
        research_note_count=len(ResearchNoteRepository(db).list_for_case(case.id)),
        statement_count=statements_count,
        can_enter_ruling=user.role == SystemRole.JUDGE,
    )
    return data


class CaseUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=4, max_length=500)
    description: Optional[str] = Field(default=None, max_length=20000)
    status: Optional[CaseStatus] = None
    statutory_deadline: Deadline = None
    assigned_judge_id: Optional[UUID] = None


@router.patch("/cases/{case_id}")
def update_case(case_id: str, req: CaseUpdate, request: Request, db: Session = Depends(get_db),
                user: UserAccount = Depends(require_role(*CASE_EDITORS))):
    case = _case_or_404(db, case_id)
    fields = req.model_dump(exclude_unset=True)
    if "assigned_judge_id" in fields and fields["assigned_judge_id"]:
        judge = UserRepository(db).get(fields["assigned_judge_id"])
        if not judge or judge.role != SystemRole.JUDGE:
            raise HTTPException(422, "The assigned judge must be an active judge account.")
    if user.role == SystemRole.JUDGE and set(fields) - {"status"}:
        raise HTTPException(403, "Judges can update a case's status; other case details are edited by case staff.")
    updated = CaseRepository(db).update(case.id, **fields)
    audit(db, request, user, "case.updated", "case", case.id, req.model_dump(exclude_unset=True, mode="json"))
    db.commit()
    _reindex(db, case.id)
    return updated.model_dump(mode="json")


# ---------------------------------------------------------------------------
# Module 4 -- priority
# ---------------------------------------------------------------------------

class PrioritySignals(BaseModel):
    public_safety_flag: bool = False
    statutory_deadline: Deadline = None
    vulnerable_victim: bool = False
    missing_critical_evidence: bool = False


@router.post("/cases/{case_id}/priority")
def compute_priority(case_id: str, req: PrioritySignals, request: Request, db: Session = Depends(get_db),
                     user: UserAccount = Depends(require_role(*CASE_EDITORS))):
    case = _case_or_404(db, case_id)
    deadline = req.statutory_deadline or case.statutory_deadline
    signals = {
        "case_id": str(case.id), "case_opened_on": case.created_at.date().isoformat(),
        "public_safety_flag": req.public_safety_flag, "vulnerable_victim": req.vulnerable_victim,
        "missing_critical_evidence": req.missing_critical_evidence,
        "statutory_deadline": deadline.isoformat() if deadline else None,
    }
    assessment = score_case(signals)
    repo = CaseRepository(db)
    repo.update_priority(case.id, assessment, signals)
    if req.statutory_deadline and req.statutory_deadline != case.statutory_deadline:
        repo.update(case.id, statutory_deadline=req.statutory_deadline)
    audit(db, request, user, "case.priority_scored", "case", case.id,
          {"level": assessment.level.value, "score": assessment.score})
    return assessment.model_dump(mode="json")


# ---------------------------------------------------------------------------
# Parties
# ---------------------------------------------------------------------------

class NewPerson(BaseModel):
    full_name: str = Field(min_length=2, max_length=255)
    emirates_id: Optional[str] = Field(default=None, max_length=24)
    contact_phone: Optional[str] = Field(default=None, max_length=40)
    preferred_language: str = Field(default="ar", pattern=r"^(ar|en)$")


class AddPartyRequest(BaseModel):
    role: HearingRole
    person_id: Optional[UUID] = None
    new_person: Optional[NewPerson] = None


def create_person_from(db: Session, new: NewPerson, role: HearingRole) -> Person:
    repo = PersonRepository(db)
    eid_hash, last4 = None, None
    if new.emirates_id:
        normalized = normalize_emirates_id(new.emirates_id)
        if not normalized:
            raise HTTPException(422, "Emirates ID must look like 784-YYYY-NNNNNNN-N.")
        eid_hash, last4 = hash_emirates_id(normalized), normalized.replace("-", "")[-4:]
        existing = repo.get_by_emirates_id_hash(eid_hash)
        if existing:
            return existing
    return repo.create(Person(
        full_name=new.full_name, emirates_id_hash=eid_hash, emirates_id_last4=last4, role_in_case=role,
        contact_phone=new.contact_phone, preferred_language=new.preferred_language,
    ))


@router.get("/cases/{case_id}/parties")
def list_parties(case_id: str, db: Session = Depends(get_db), _user: UserAccount = Depends(require_role(*STAFF))):
    case = _case_or_404(db, case_id)
    return [p.model_dump(mode="json") for p in CaseRepository(db).parties(case.id)]


@router.post("/cases/{case_id}/parties", status_code=201)
def add_party(case_id: str, req: AddPartyRequest, request: Request, db: Session = Depends(get_db),
              user: UserAccount = Depends(require_role(*CASE_EDITORS))):
    case = _case_or_404(db, case_id)
    if req.person_id:
        person = PersonRepository(db).get(req.person_id)
        if not person:
            raise HTTPException(404, "Person not found.")
    elif req.new_person:
        person = create_person_from(db, req.new_person, req.role)
    else:
        raise HTTPException(422, "Provide either person_id or new_person.")
    CaseRepository(db).add_party(case.id, person.id, req.role.value)
    audit(db, request, user, "case.party_added", "case", case.id,
          {"person_id": str(person.id), "role": req.role.value})
    db.commit()
    safe_graph_call("link_person_to_case", person.id, case.id, req.role.value, person.full_name, case.case_number)
    index_person(person)
    _reindex(db, case.id)
    return {"person": person.model_dump(mode="json"), "role": req.role.value}


@router.delete("/cases/{case_id}/parties/{person_id}", status_code=204)
def remove_party(case_id: str, person_id: str, request: Request, db: Session = Depends(get_db),
                 user: UserAccount = Depends(require_role(*CASE_BUILDERS))):
    case = _case_or_404(db, case_id)
    pid = parse_uuid_or_404(person_id, "Person")
    if not CaseRepository(db).remove_party(case.id, pid):
        raise HTTPException(404, "Party not found on this case.")
    audit(db, request, user, "case.party_removed", "case", case.id, {"person_id": str(pid)})
    db.commit()
    safe_graph_call("unlink_person_from_case", pid, case.id)
    _reindex(db, case.id)


# ---------------------------------------------------------------------------
# Timeline + Module 2 extraction
# ---------------------------------------------------------------------------

class ManualEvent(BaseModel):
    event_date: Optional[date] = None
    description: str = Field(min_length=3, max_length=2000)


@router.post("/cases/{case_id}/timeline", status_code=201)
def add_timeline_event(case_id: str, req: ManualEvent, request: Request, db: Session = Depends(get_db),
                       user: UserAccount = Depends(require_role(*CASE_EDITORS))):
    case = _case_or_404(db, case_id)
    updated = CaseRepository(db).add_timeline_events(case.id, [TimelineEvent(
        case_id=case.id, event_date=req.event_date, description=req.description, entity_type="manual",
        source_label=f"Added by {user.full_name}",
    )])
    audit(db, request, user, "case.timeline_added", "case", case.id, {"description": req.description[:200]})
    return [t.model_dump(mode="json") for t in updated.timeline]


@router.delete("/cases/{case_id}/timeline/{event_id}", status_code=204)
def delete_timeline_event(case_id: str, event_id: str, request: Request, db: Session = Depends(get_db),
                          user: UserAccount = Depends(require_role(*CASE_BUILDERS))):
    case = _case_or_404(db, case_id)
    if not CaseRepository(db).delete_timeline_event(case.id, event_id):
        raise HTTPException(404, "Timeline event not found.")
    audit(db, request, user, "case.timeline_removed", "case", case.id, {"event_id": event_id})


class DocumentText(BaseModel):
    document_label: str = Field(min_length=2, max_length=200)
    raw_text: str = Field(min_length=10, max_length=200_000)


@router.post("/cases/{case_id}/extract")
def extract_case_intelligence(case_id: str, payload: DocumentText, request: Request, db: Session = Depends(get_db),
                              user: UserAccount = Depends(require_role(*CASE_EDITORS))):
    case = _case_or_404(db, case_id)
    result = run_case_intelligence(str(case.id), payload.raw_text, payload.document_label)
    events = []
    for e in result.get("timeline_events", [])[:60]:
        try:
            event_date = date.fromisoformat(e["event_date"]) if e.get("event_date") else None
        except ValueError:
            event_date = None
        events.append(TimelineEvent(case_id=case.id, event_date=event_date, description=e["description"],
                                    entity_type="event", source_label=payload.document_label))
    if events:
        CaseRepository(db).add_timeline_events(case.id, events)
    audit(db, request, user, "case.intelligence_extracted", "case", case.id,
          {"label": payload.document_label, "entities": len(result.get("entities", []))})
    db.commit()
    _reindex(db, case.id)
    return {
        "entities": result.get("entities", []),
        "charges_mentioned": result.get("charges_mentioned", []),
        "offence_mentions": result.get("offence_mentions", []),
        "legal_references": result.get("legal_references", []),
        "timeline_events": result.get("timeline_events", []),
        "warnings": result.get("warnings", []),
        "ai_used": bool(result.get("offence_mentions")),
    }


class CompareRequest(BaseModel):
    source_a: str
    source_b: str


def _source_text(db: Session, case: Case, ref: str) -> tuple[str, str]:
    kind, _, raw_id = ref.partition(":")
    if kind == "evidence":
        ev = EvidenceRepository(db).get(parse_uuid_or_404(raw_id, "Evidence"))
        if not ev or ev.case_id != case.id:
            raise HTTPException(404, "Evidence not found on this case.")
        text = ""
        if mongo_probe.available():
            doc = EvidenceTextRepository(get_mongo_db()).get(str(ev.id))
            text = (doc or {}).get("text", "")
        if not text:
            row = EvidenceRepository(db).row(ev.id)
            text = row.ocr_text_fallback or ""
        return ev.label, text
    if kind == "statement":
        if not mongo_probe.available():
            raise HTTPException(503, "Statements are temporarily unavailable.")
        st = StatementRepository(get_mongo_db()).get(raw_id)
        if not st or st.case_id != case.id:
            raise HTTPException(404, "Statement not found on this case.")
        return f"Statement: {st.person_name or st.role.value}", st.transcript or ""
    raise HTTPException(422, "Sources must look like 'evidence:<id>' or 'statement:<id>'.")


@router.post("/cases/{case_id}/compare")
def compare(case_id: str, req: CompareRequest, request: Request, db: Session = Depends(get_db),
            user: UserAccount = Depends(require_role(*STAFF))):
    case = _case_or_404(db, case_id)
    label_a, text_a = _source_text(db, case, req.source_a)
    label_b, text_b = _source_text(db, case, req.source_b)
    if len(text_a.strip()) < 20 or len(text_b.strip()) < 20:
        raise HTTPException(422, "Both sources need extracted text to compare. Wait for processing to finish.")
    audit(db, request, user, "case.sources_compared", "case", case.id, {"a": req.source_a, "b": req.source_b})
    return compare_sources(label_a, text_a, label_b, text_b)


# ---------------------------------------------------------------------------
# Module 5 -- similar & related cases
# ---------------------------------------------------------------------------

@router.get("/cases/{case_id}/similar")
def similar_cases(case_id: str, db: Session = Depends(get_db), _user: UserAccount = Depends(require_role(*STAFF))):
    """Meaning (embedding vectors, Arabic and English alike) blended with shared wording."""
    from app.agents.graph_orchestrator import token_similarity
    from app.ai import embeddings
    from app.services.indexing import case_semantic_text, case_vector

    case = _case_or_404(db, case_id)
    repo = CaseRepository(db)
    text = "\n".join(filter(None, [case.title, case.description or "", *(t.description for t in case.timeline[:50])]))
    # The case's own vector is already in the index, so matching by meaning needs
    # no model here. Only if it is missing do we fall back to computing one, and
    # then only when that is cheap -- the reader never waits for a cold model.
    vector = search.get_vector("cases", case.id) or case_vector(case)
    warming = vector is None
    lexical = search.more_like_this("cases", text, exclude_id=case.id, limit=10)
    semantic = search.knn("cases", vector, exclude_id=case.id, k=10) if vector is not None else None

    scores: dict[str, dict] = {}
    if lexical is not None or semantic is not None:
        source = "elasticsearch"
        # "More like this" finds candidates; its scores are relative, so wording is
        # measured absolutely (shared content words) for a comparable number.
        for h in lexical or []:
            other_text = "\n".join(filter(None, [h["source"].get("title"), h["source"].get("body")]))
            scores.setdefault(h["id"], {})["wording"] = round(token_similarity(text, other_text), 2)
        for h in semantic or []:
            scores.setdefault(h["id"], {})["meaning"] = round(max(h["similarity"], 0.0), 2)
    else:
        # Search cluster down: compare with recent cases directly.
        source = "fallback"
        others, _ = repo.search(limit=150)
        others = [o for o in others if o.id != case.id]
        meanings = None
        if vector is not None and others:
            try:
                other_vectors = embeddings.embed([case_semantic_text(o)[:1500] for o in others])
                meanings = other_vectors @ np.asarray(vector, dtype=np.float32)
            except embeddings.ModelUnavailable:
                meanings = None
        for i, other in enumerate(others):
            entry = {"wording": round(token_similarity(text, "\n".join(filter(None, [other.title, other.description or ""]))), 2)}
            if meanings is not None:
                entry["meaning"] = round(max(float(meanings[i]), 0.0), 2)
            scores[str(other.id)] = entry

    ranked = []
    for other_id, s in scores.items():
        meaning, wording = s.get("meaning"), s.get("wording")
        wording_scaled = min(1.0, (wording or 0.0) / 0.4)   # 40% shared words already reads as near-identical
        if meaning is not None:
            relevance = 0.7 * meaning + 0.3 * wording_scaled
        else:
            relevance = wording_scaled
        # Measured on real case text: the same kind of incident scores ~0.69,
        # unrelated files reach ~0.53, so the floor sits above the noise.
        if (meaning or 0) < 0.55 and (wording or 0) < 0.25:
            continue
        ranked.append((relevance, other_id, meaning, wording))

    results = []
    for relevance, other_id, meaning, wording in sorted(ranked, reverse=True)[:8]:
        other = repo.get(other_id)
        if not other:
            continue
        reasons = []
        if meaning is not None and meaning >= 0.55:
            reasons.append(f"similar meaning ({meaning:.0%})")
        if wording is not None and wording >= 0.25:
            reasons.append(f"shared wording ({wording:.0%})")
        results.append({"case_id": str(other.id), "case_number": other.case_number, "title": other.title,
                        "status": other.status.value, "case_type": other.case_type.value,
                        "relevance": round(relevance, 2), "meaning": meaning, "wording": wording,
                        "reason": (" and ".join(reasons) or "related wording").capitalize() + "."})
    methods = ["meaning", "wording"] if vector is not None else ["wording"]
    return {"source": source, "items": results, "methods": methods, "meaning_model_warming": warming,
            "note": "Leads for review only -- similarity says nothing about the outcome of either case."}


# ---------------------------------------------------------------------------
# Case brief (Modules 2, 12): quoted key facts, plus an optional checked draft
# ---------------------------------------------------------------------------

@router.get("/cases/{case_id}/brief")
def case_brief_view(case_id: str, db: Session = Depends(get_db), _user: UserAccount = Depends(require_role(*STAFF))):
    case = _case_or_404(db, case_id)
    return case_brief.gather(db, case)


@router.post("/cases/{case_id}/brief/stream")
def case_brief_stream(case_id: str, request: Request, lang: str = Query(default="en", pattern="^(en|ar)$"),
                      db: Session = Depends(get_db), user: UserAccount = Depends(require_role(*STAFF))):
    """SSE: `sources` (the quoted key facts), `status`, `token`, then one `final` with the checked draft."""
    case = _case_or_404(db, case_id)
    brief = case_brief.gather(db, case)
    audit(db, request, user, "case.brief_drafted", "case", case.id, {"language": lang})
    db.commit()

    def events():
        yield sse("sources", brief)
        sources = case_brief.draft_sources(brief)
        if sum(len(s["sentences"]) for s in brief["sections"]) < case_brief.MIN_SENTENCES_FOR_DRAFT:
            # A small model given almost nothing fills the gap with invention; the quotes are the brief.
            yield sse("final", {"status": "no_sources", "draft": "", "reason":
                                "The file has too little text for a useful draft yet -- the key facts above are the whole file."})
            return
        try:
            for kind, payload in stream_grounded_draft(case_brief.draft_messages(case, brief, lang), sources, lang,
                                                       max_tokens=380):
                if kind != "draft":
                    yield sse(kind, payload)
                    continue
                if payload["status"] == "ok":
                    yield sse("final", {"status": "ok", "draft": payload["text"], "grounding": payload["grounding"],
                                        "model": payload["model"], "unsupported": payload["unsupported"],
                                        "reason": "Draft by a small local model, checked against the key facts above. "
                                                  "Sentences that match no note are marked, and so are figures the "
                                                  "notes don't contain. It can still join two facts that belong "
                                                  "apart, so read it against the notes below."})
                else:
                    yield sse("final", {"status": payload["status"], "draft": "",
                                        "reason": payload["reason"] + " The quoted key facts above are unaffected."})
        except Exception:
            log.exception("case brief draft failed")
            yield sse("final", {"status": "error", "draft": "", "reason": "The draft could not be written just now."})

    return event_stream(events())


@router.get("/cases/{case_id}/related")
def related_cases(case_id: str, db: Session = Depends(get_db), _user: UserAccount = Depends(require_role(*STAFF))):
    case = _case_or_404(db, case_id)
    repo = CaseRepository(db)
    people = {str(p.person.id): p.person.full_name for p in repo.parties(case.id)}
    shared_parties: list[dict] = []
    shared_citations: list[dict] = []
    source = "neo4j"
    g = graph()
    if g is not None:
        try:
            for row in g.co_parties(case.id):
                other = repo.get(row["other_case_id"])
                if other:
                    shared_parties.append({"person_id": row["person_id"], "person_name": people.get(row["person_id"]),
                                           "role_in_other_case": row.get("role"), "case_id": str(other.id),
                                           "case_number": other.case_number, "title": other.title,
                                           "status": other.status.value})
            for row in g.cases_sharing_citations(case.id):
                other = repo.get(row["other_case_id"])
                if other:
                    shared_citations.append({"case_id": str(other.id), "case_number": other.case_number,
                                             "title": other.title, "citations": row["citations"]})
        except Exception as exc:
            neo4j_probe.mark_down(exc)
            g = None
    if g is None:
        source = "fallback"
        shared_parties = []
        for pid, name in people.items():
            for other in repo.cases_for_person(pid):
                if other["case_id"] != str(case.id):
                    shared_parties.append({"person_id": pid, "person_name": name, "role_in_other_case": other["role"],
                                           "case_id": other["case_id"], "case_number": other["case_number"],
                                           "title": other["title"], "status": other["status"]})
    return {"source": source, "shared_parties": shared_parties, "shared_citations": shared_citations,
            "note": "Connections are leads for a human to review, not conclusions."}


# ---------------------------------------------------------------------------
# Research notes (Module 6 saved to a case)
# ---------------------------------------------------------------------------

class ResearchNoteCreate(BaseModel):
    question: str = Field(min_length=3, max_length=4000)
    answer: str = Field(default="", max_length=40000)
    citations: list[dict] = Field(default_factory=list, max_length=20)
    confidence: float = Field(default=0.0, ge=0, le=1)
    needs_human_review: bool = True


@router.get("/cases/{case_id}/research-notes")
def list_research_notes(case_id: str, db: Session = Depends(get_db),
                        _user: UserAccount = Depends(require_role(*STAFF))):
    case = _case_or_404(db, case_id)
    return [n.model_dump(mode="json") for n in ResearchNoteRepository(db).list_for_case(case.id)]


@router.post("/cases/{case_id}/research-notes", status_code=201)
def save_research_note(case_id: str, req: ResearchNoteCreate, request: Request, db: Session = Depends(get_db),
                       user: UserAccount = Depends(require_role(*STAFF))):
    case = _case_or_404(db, case_id)
    note = ResearchNoteRepository(db).create(ResearchNote(
        case_id=case.id, question=req.question, answer=req.answer, citations=req.citations,
        confidence=req.confidence, needs_human_review=req.needs_human_review, created_by=user.id,
    ))
    audit(db, request, user, "case.research_saved", "case", case.id, {"note_id": str(note.id)})
    db.commit()
    today = date.today().isoformat()
    for c in req.citations:
        ref = f"{c.get('source_title', '')} | {c.get('article_label') or c.get('article') or ''}".strip(" |")
        if ref:
            safe_graph_call("link_case_to_citation", case.id, ref[:300], today)
    return note.model_dump(mode="json")


# ---------------------------------------------------------------------------
# Statements + audit for a case
# ---------------------------------------------------------------------------

@router.get("/cases/{case_id}/statements")
def case_statements(case_id: str, db: Session = Depends(get_db), _user: UserAccount = Depends(require_role(*STAFF))):
    case = _case_or_404(db, case_id)
    if not mongo_probe.available():
        raise HTTPException(503, "Statements are temporarily unavailable (MongoDB is not reachable).")
    items = StatementRepository(get_mongo_db()).list_for_case(str(case.id))
    return [s.model_dump(mode="json", exclude={"live_segments", "recording_path"}) for s in items]


@router.get("/cases/{case_id}/audit")
def case_audit(case_id: str, db: Session = Depends(get_db),
               _user: UserAccount = Depends(require_role(SystemRole.JUDGE, SystemRole.CLERK, SystemRole.ADMIN,
                                                         SystemRole.CASE_OFFICER))):
    case = _case_or_404(db, case_id)
    entries, total = AuditRepository(db).search(entity_type="case", entity_id=str(case.id), limit=200)
    return {"items": [e.model_dump(mode="json") for e in entries], "total": total}


# ---------------------------------------------------------------------------
# Ruling: human-entered only, judge-only. See docs/DESIGN_DECISIONS.md.
# ---------------------------------------------------------------------------

class RulingRequest(BaseModel):
    ruling_text: str = Field(min_length=20, max_length=100_000)
    ai_assisted_research_refs: list[str] = Field(default_factory=list, max_length=50)
    close_case: bool = True


@router.get("/cases/{case_id}/ruling")
def get_ruling(case_id: str, db: Session = Depends(get_db), _user: UserAccount = Depends(require_role(*STAFF))):
    case = _case_or_404(db, case_id)
    ruling = RulingRepository(db).get(case.id)
    if not ruling:
        return None
    judge = UserRepository(db).get(ruling.entered_by)
    data = ruling.model_dump(mode="json")
    data["entered_by_name"] = judge.full_name if judge else None
    return data


@router.post("/cases/{case_id}/ruling")
def enter_ruling(case_id: str, req: RulingRequest, request: Request, db: Session = Depends(get_db),
                 judge: UserAccount = Depends(require_role(SystemRole.JUDGE))):
    """
    require_role(SystemRole.JUDGE) is the entire reason this is safe to expose.
    `entered_by` is taken from the authenticated judge's own token, never from
    the request body -- nothing a caller sends can attribute a ruling to anyone
    else, human or AI.
    """
    case = _case_or_404(db, case_id)
    ruling = CaseRuling(case_id=case.id, entered_by=judge.id, ruling_text=req.ruling_text,
                        ai_assisted_research_refs=req.ai_assisted_research_refs)
    saved = RulingRepository(db).create(ruling)
    if req.close_case:
        CaseRepository(db).update(case.id, status=CaseStatus.RESOLVED)
    audit(db, request, judge, "case.ruling_entered", "case", case.id, {"length": len(req.ruling_text)})
    data = saved.model_dump(mode="json")
    data["entered_by_name"] = judge.full_name
    return data
