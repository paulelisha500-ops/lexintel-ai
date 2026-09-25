"""
API route aggregation. Each module's endpoints live in app/api/routers/:

  auth_routes.py          -> security: login, staff accounts, passwords
  routers/complaints.py   -> Module 1 + 11: public intake & tracking, staff triage
  routers/cases.py        -> Modules 2, 4, 5: case workspace, priority, similar/related, ruling
  routers/evidence.py     -> Modules 3, 9: evidence upload, OCR, signature checks, custody log
  routers/scheduling.py   -> Module 7: hearings with conflict detection, people registry
  routers/courtroom.py    -> the stand: sessions, live transcript, recordings
  routers/research.py     -> Module 6: legal research + Law Library
  routers/insights.py     -> Module 10 analytics, global search, admin system/audit, AI model status
  routers/internal.py     -> service-to-service: the worker borrows the API's embedding model

Every AI-touched endpoint returns an explanation alongside its output
(Module 12). None returns a verdict, a guilt/credibility score, or an emotion
reading -- see docs/DESIGN_DECISIONS.md. Every endpoint except the public
complaint intake/tracking and login requires an authenticated staff account;
entering a ruling additionally requires SystemRole.JUDGE.
"""

from fastapi import APIRouter

from app.api.routers import cases, complaints, courtroom, evidence, insights, internal, research, scheduling

router = APIRouter()
for module in (complaints, cases, evidence, scheduling, courtroom, research, insights, internal):
    router.include_router(module.router)
