"""
Elasticsearch: full-text search across cases, complaints, people, evidence
text, statement transcripts and law articles; "more like this" for
duplicate-complaint detection and similar-case retrieval (Module 5).

Every public method returns None (or False) when Elasticsearch is
unreachable instead of raising -- callers then use their Postgres/Mongo
fallback. Text fields are indexed three ways (standard, arabic, english
analyzers) because UAE case material mixes both languages.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

from app.core.config import get_settings
from app.core.resilience import Probe

log = logging.getLogger("lexintel.search")
settings = get_settings()

PREFIX = "lexintel"
KINDS = ("cases", "complaints", "people", "evidence", "statements", "law")

_TEXT = {
    "type": "text",
    "analyzer": "standard",
    "fields": {"ar": {"type": "text", "analyzer": "arabic"}, "en": {"type": "text", "analyzer": "english"}},
}

# Meaning vector from app/ai/embeddings.py (384-d, cosine), for semantic "similar cases".
_VECTOR = {"type": "dense_vector", "dims": 384, "index": True, "similarity": "cosine"}
_VECTOR_KINDS = ("cases",)

_MAPPINGS: dict[str, dict] = {
    "cases": {"title": _TEXT, "body": _TEXT, "case_number": {"type": "keyword"}, "case_type": {"type": "keyword"},
              "status": {"type": "keyword"}, "created_at": {"type": "date"}, "vector": _VECTOR},
    "complaints": {"title": _TEXT, "body": _TEXT, "reference_number": {"type": "keyword"},
                   "case_type": {"type": "keyword"}, "status": {"type": "keyword"}, "created_at": {"type": "date"}},
    "people": {"title": _TEXT, "body": _TEXT},
    "evidence": {"title": _TEXT, "body": _TEXT, "case_id": {"type": "keyword"}},
    "statements": {"title": _TEXT, "body": _TEXT, "case_id": {"type": "keyword"}, "hearing_id": {"type": "keyword"}},
    "law": {"title": _TEXT, "body": _TEXT, "article": {"type": "keyword"}, "jurisdiction": {"type": "keyword"},
            "law_document_id": {"type": "keyword"}, "effective_from": {"type": "keyword"},
            "effective_to": {"type": "keyword"}, "source_url": {"type": "keyword", "index": False}},
}


def index_name(kind: str) -> str:
    return f"{PREFIX}-{kind}"


@lru_cache
def _client():
    from elasticsearch import Elasticsearch

    return Elasticsearch(settings.elasticsearch_url, request_timeout=5, max_retries=1, retry_on_timeout=False)


def _check() -> None:
    if not settings.elasticsearch_enabled:
        raise RuntimeError("disabled by ELASTICSEARCH_ENABLED=false")
    info = _client().cluster.health(timeout="2s")
    if info.get("status") == "red":
        raise RuntimeError("cluster health is red")


es_probe = Probe("elasticsearch", _check)
_indices_ready = False


def ensure_indices() -> bool:
    global _indices_ready
    if _indices_ready:
        return True
    if not es_probe.available():
        return False
    try:
        client = _client()
        for kind, props in _MAPPINGS.items():
            name = index_name(kind)
            if not client.indices.exists(index=name):
                client.indices.create(index=name, mappings={"properties": props})
            elif kind in _VECTOR_KINDS:
                try:  # indices created before vectors existed get the new field added
                    client.indices.put_mapping(index=name, properties={"vector": _VECTOR})
                except Exception as exc:
                    log.warning("could not add vector field to %s: %s", name, exc)
        _indices_ready = True
        return True
    except Exception as exc:
        # Another process may have created the index between exists() and create().
        if "resource_already_exists" in str(exc):
            _indices_ready = True
            return True
        es_probe.mark_down(exc)
        return False


def index_doc(kind: str, doc_id: Any, doc: dict[str, Any]) -> bool:
    if not ensure_indices():
        return False
    try:
        _client().index(index=index_name(kind), id=str(doc_id), document=doc)
        return True
    except Exception as exc:
        log.warning("index %s/%s failed: %s", kind, doc_id, exc)
        es_probe.mark_down(exc)
        return False


def bulk_index(kind: str, docs: list[tuple[str, dict]]) -> bool:
    if not docs or not ensure_indices():
        return False
    try:
        from elasticsearch.helpers import bulk

        bulk(_client(), ({"_index": index_name(kind), "_id": str(i), "_source": d} for i, d in docs),
             request_timeout=120)
        return True
    except Exception as exc:
        log.warning("bulk index %s failed: %s", kind, exc)
        es_probe.mark_down(exc)
        return False


def delete_doc(kind: str, doc_id: Any) -> None:
    if not es_probe.available():
        return
    try:
        _client().delete(index=index_name(kind), id=str(doc_id), ignore=[404])
    except Exception as exc:
        log.warning("delete %s/%s failed: %s", kind, doc_id, exc)


def delete_by_field(kind: str, field: str, value: str) -> None:
    if not es_probe.available():
        return
    try:
        _client().delete_by_query(index=index_name(kind), query={"term": {field: value}},
                                  conflicts="proceed", refresh=True)
    except Exception as exc:
        log.warning("delete_by_query %s failed: %s", kind, exc)


def _multi_match(q: str) -> dict:
    return {
        "multi_match": {
            "query": q,
            "fields": ["title^3", "title.ar^3", "title.en^3", "body", "body.ar", "body.en",
                       "case_number^5", "reference_number^5"],
            "type": "best_fields",
            "fuzziness": "AUTO",
            "lenient": True,
        }
    }


def search(q: str, kinds: list[str] | None = None, limit: int = 8) -> dict[str, list[dict]] | None:
    """Returns {kind: [{id, score, source, highlight}]}, or None if ES is down."""
    if not q.strip() or not ensure_indices():
        return None
    wanted = [k for k in (kinds or KINDS) if k in _MAPPINGS]
    try:
        body = []
        for kind in wanted:
            body.append({"index": index_name(kind)})
            body.append({
                "size": limit,
                "_source": {"excludes": ["vector"]},
                "query": _multi_match(q),
                "highlight": {"fields": {"body": {"fragment_size": 160, "number_of_fragments": 1},
                                         "body.ar": {"fragment_size": 160, "number_of_fragments": 1}},
                              "pre_tags": ["<mark>"], "post_tags": ["</mark>"]},
            })
        responses = _client().msearch(searches=body)["responses"]
        out: dict[str, list[dict]] = {}
        for kind, resp in zip(wanted, responses):
            hits = resp.get("hits", {}).get("hits", []) if "error" not in resp else []
            out[kind] = [
                {"id": h["_id"], "score": h.get("_score") or 0.0, "source": h.get("_source", {}),
                 "highlight": next(iter((h.get("highlight") or {}).values()), [None])[0]}
                for h in hits
            ]
        return out
    except Exception as exc:
        log.warning("search failed: %s", exc)
        es_probe.mark_down(exc)
        return None


def more_like_this(kind: str, text: str, exclude_id: Any = None, limit: int = 5,
                   filters: list[dict] | None = None) -> list[dict] | None:
    if not text.strip() or not ensure_indices():
        return None
    must_not = [{"ids": {"values": [str(exclude_id)]}}] if exclude_id else []
    try:
        resp = _client().search(
            index=index_name(kind),
            size=limit,
            source_excludes=["vector"],
            query={"bool": {
                "must": [{"more_like_this": {
                    "fields": ["title", "body", "body.ar", "body.en"],
                    "like": text[:5000],
                    "min_term_freq": 1, "min_doc_freq": 1, "max_query_terms": 40,
                    "minimum_should_match": "25%",
                }}],
                "must_not": must_not,
                "filter": filters or [],
            }},
        )
        return [{"id": h["_id"], "score": h.get("_score") or 0.0, "source": h.get("_source", {})}
                for h in resp["hits"]["hits"]]
    except Exception as exc:
        log.warning("more_like_this failed: %s", exc)
        es_probe.mark_down(exc)
        return None


def knn(kind: str, vector: list[float], exclude_id: Any = None, k: int = 8,
        filters: list[dict] | None = None) -> list[dict] | None:
    """Nearest neighbours by meaning. `similarity` is the cosine similarity (-1..1)."""
    if kind not in _VECTOR_KINDS or not ensure_indices():
        return None
    must_not = [{"ids": {"values": [str(exclude_id)]}}] if exclude_id else []
    try:
        resp = _client().search(
            index=index_name(kind),
            size=k,
            knn={"field": "vector", "query_vector": list(map(float, vector)), "k": k,
                 "num_candidates": max(50, k * 10),
                 "filter": {"bool": {"must_not": must_not, "filter": filters or []}}},
            source_excludes=["vector"],
        )
        # ES reports cosine as (1 + cos) / 2.
        return [{"id": h["_id"], "similarity": round(2 * (h.get("_score") or 0.5) - 1, 3), "source": h.get("_source", {})}
                for h in resp["hits"]["hits"]]
    except Exception as exc:
        log.warning("knn on %s failed: %s", kind, exc)
        es_probe.mark_down(exc)
        return None


def get_vector(kind: str, doc_id: Any) -> list[float] | None:
    """The stored meaning vector, so a search by meaning needs no model in this process."""
    if kind not in _VECTOR_KINDS or not ensure_indices():
        return None
    try:
        resp = _client().get(index=index_name(kind), id=str(doc_id), source_includes=["vector"], ignore=[404])
        vector = (resp.get("_source") or {}).get("vector")
        return list(vector) if vector else None
    except Exception as exc:
        log.warning("get_vector %s/%s failed: %s", kind, doc_id, exc)
        return None


def ids_missing_vectors(kind: str, limit: int = 500) -> list[str] | None:
    if kind not in _VECTOR_KINDS or not ensure_indices():
        return None
    try:
        resp = _client().search(index=index_name(kind), size=limit, source=False,
                                query={"bool": {"must_not": [{"exists": {"field": "vector"}}]}})
        return [h["_id"] for h in resp["hits"]["hits"]]
    except Exception as exc:
        log.warning("missing-vector scan on %s failed: %s", kind, exc)
        return None


def set_vector(kind: str, doc_id: Any, vector: list[float]) -> bool:
    if not ensure_indices():
        return False
    try:
        _client().update(index=index_name(kind), id=str(doc_id), doc={"vector": list(map(float, vector))})
        return True
    except Exception as exc:
        log.warning("set_vector %s/%s failed: %s", kind, doc_id, exc)
        return False


def law_search(q: str, jurisdiction: str | None = None, limit: int = 8) -> list[dict] | None:
    if not q.strip() or not ensure_indices():
        return None
    filters = [{"term": {"jurisdiction": jurisdiction}}] if jurisdiction else []
    try:
        resp = _client().search(
            index=index_name("law"),
            size=limit,
            query={"bool": {"must": [{"multi_match": {
                "query": q, "fields": ["title^2", "title.ar^2", "body", "body.ar", "body.en", "article^4"],
                "lenient": True,
            }}], "filter": filters}},
        )
        return [{"id": h["_id"], "score": h.get("_score") or 0.0, "source": h.get("_source", {})}
                for h in resp["hits"]["hits"]]
    except Exception as exc:
        log.warning("law_search failed: %s", exc)
        es_probe.mark_down(exc)
        return None


def doc_count(kind: str) -> int | None:
    if not ensure_indices():
        return None
    try:
        return int(_client().count(index=index_name(kind))["count"])
    except Exception:
        return None
