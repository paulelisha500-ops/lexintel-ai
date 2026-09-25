"""
Celery application (Redis broker). Start with:
    celery -A app.worker.celery_app worker -B -l info

Beat schedule (Asia/Dubai time):
  - every 10 min: re-dispatch evidence / law documents stuck in queued|processing
  - 02:00 daily:  re-score open case priorities (case age changes every day)
  - 03:00 daily:  re-index search + resync the relationship graph
"""

from __future__ import annotations

import logging

from celery import Celery
from celery.schedules import crontab
from celery.signals import worker_ready

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery("lexintel", broker=settings.redis_url, backend=settings.redis_url, include=["app.tasks"])
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    result_expires=3600,
    timezone="Asia/Dubai",
    enable_utc=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_time_limit=3600,
    task_soft_time_limit=3300,
    broker_connection_retry_on_startup=True,
    broker_connection_timeout=4,
    broker_transport_options={"visibility_timeout": 7200},
    beat_schedule={
        "retry-stuck-jobs": {"task": "lexintel.retry_stuck_jobs", "schedule": 600.0},
        "rescore-priorities": {"task": "lexintel.rescore_priorities", "schedule": crontab(hour=2, minute=0)},
        "reindex-all": {"task": "lexintel.reindex_all", "schedule": crontab(hour=3, minute=0)},
    },
)


@worker_ready.connect  # fires for every pool type (worker_process_init is prefork-only)
def _init_worker(**_kwargs) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    for noisy in ("elastic_transport", "elasticsearch", "neo4j", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.ERROR)
    from app.db.base import init_db

    try:
        init_db()
    except Exception:
        logging.getLogger("lexintel.worker").exception("init_db failed in worker")

    import threading

    threading.Thread(target=_catch_up_search_index, daemon=True, name="search-catch-up").start()


def _catch_up_search_index() -> None:
    """Records created while Elasticsearch was down aren't in the index; if the
    search index is behind the database after startup, rebuild it once."""
    import time

    log = logging.getLogger("lexintel.worker")
    time.sleep(45)
    try:
        from sqlalchemy import func, select

        from app.db import search
        from app.db.base import get_session
        from app.db.orm_models import CaseORM
        from app.tasks import rebuild_law_index_if_model_changed_job, reindex_all_job

        rebuild_law_index_if_model_changed_job()
        indexed = search.doc_count("cases")
        if indexed is None:
            return
        with get_session() as db:
            total = db.execute(select(func.count()).select_from(CaseORM)).scalar() or 0
        if indexed < total:
            log.info("search index behind database (%s < %s cases); reindexing", indexed, total)
            reindex_all_job()
    except Exception:
        log.exception("search catch-up failed")
