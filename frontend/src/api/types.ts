export interface Priority {
  case_id: string;
  level: "high" | "medium" | "low";
  score: number;
  factors: Record<string, number>;
  explanation: string;
  generated_at: string;
  requires_human_review: boolean;
}

export interface TimelineEvent {
  id: string;
  case_id: string;
  event_date: string | null;
  description: string;
  source_document_id: string | null;
  source_label: string | null;
  entity_type: string;
  created_at: string | null;
}

export interface Person {
  id: string;
  full_name: string;
  emirates_id_last4: string | null;
  role_in_case: string | null;
  reference_photo_on_file: boolean;
  contact_phone: string | null;
  preferred_language: string;
  created_at: string | null;
}

export interface CaseParty {
  person: Person;
  role: string;
  added_at: string | null;
}

export interface CaseSummary {
  id: string;
  case_number: string;
  case_type: string;
  status: string;
  title: string;
  description: string | null;
  parties: string[];
  evidence: string[];
  priority: Priority | null;
  priority_signals: Record<string, unknown> | null;
  assigned_judge_id: string | null;
  source_complaint_id: string | null;
  created_at: string;
  updated_at: string | null;
  closed_at: string | null;
  statutory_deadline: string | null;
  party_count?: number;
  evidence_count?: number;
  next_hearing?: string | null;
  timeline_count?: number;
}

export interface Hearing {
  id: string;
  case_id: string;
  scheduled_at: string;
  duration_minutes: number;
  hearing_type: string | null;
  courtroom: string | null;
  status: string;
  presiding_judge_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  case_number?: string | null;
  case_title?: string | null;
  case_type?: string | null;
  judge_name?: string | null;
  ends_at?: string;
}

export interface Ruling {
  case_id: string;
  entered_by: string;
  entered_by_name?: string | null;
  ruling_text: string;
  entered_at: string;
  ai_assisted_research_refs: string[];
}

export interface CaseDetail extends CaseSummary {
  timeline: TimelineEvent[];
  parties_detail?: never;
  hearings: Hearing[];
  evidence_summary: { total: number; pending_review: number; processing: number };
  ruling: Ruling | null;
  assigned_judge: { id: string; full_name: string } | null;
  research_note_count: number;
  statement_count: number | null;
  can_enter_ruling: boolean;
}

export interface CaseDetailResponse extends Omit<CaseDetail, "parties"> {
  parties: CaseParty[];
}

export interface Paged<T> {
  items: T[];
  total: number;
}

export interface Complaint {
  id: string;
  reference_number: string | null;
  case_type: string;
  description: string;
  location: string | null;
  complainant_name: string | null;
  complainant_phone: string | null;
  complainant_email: string | null;
  preferred_language: string | null;
  status: string;
  submitted_at: string;
  updated_at: string | null;
  ai_status: "pending" | "done" | "fallback" | "failed";
  ai_suggested_category: string | null;
  ai_duplicate_of: string | null;
  ai_suggested_department: string | null;
  ai_confidence: number | null;
  ai_explanation: string | null;
  ai_priority_level: string | null;
  duplicate_candidates: DuplicateCandidate[] | null;
  ai_details: ClassifierDetails | null;
  category_confirmed: boolean;
  assigned_department: string | null;
  staff_notes: string | null;
  case_id: string | null;
}

export interface DuplicateCandidate {
  id: string;
  reference_number: string | null;
  similarity: number;
  meaning?: number | null;
  wording?: number;
}

/** How the complaint classifier reached its suggestion (app/ai/classifier.py). */
export interface ClassifierDetails {
  method: "semantic" | "keywords";
  model?: string;
  probabilities?: Record<string, number>;
  neighbours?: { text: string; category: string; similarity: number; source: "example" | "staff decision" }[];
  learned_examples?: number;
  keyword_suggestion?: string;
  priority_explanation?: string | null;
  error?: string;
}

export interface OffenceMention {
  offence: string;
  label_en: string;
  label_ar: string;
  sentence: string;
  score: number;
}

export interface LegalReference {
  kind: "law" | "article";
  reference: string;
  context: string;
  source?: string;
}

export interface ExtractiveSummary {
  sentences: { index: number; text: string }[];
  method: "semantic" | "word-frequency" | "all" | "none";
  coverage: number;
  sentence_count?: number;
}

export interface Evidence {
  id: string;
  case_id: string;
  label: string;
  evidence_type: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  uploaded_by: string;
  uploaded_at: string;
  processing_status: string;
  processing_error: string | null;
  processed_at: string | null;
  ocr_confidence: number | null;
  ocr_language: string | null;
  page_count: number | null;
  text_length: number | null;
  entity_count: number | null;
  signature_check: {
    signature_present: boolean;
    match_score: number | null;
    flagged_for_human_review: boolean;
    explanation: string | null;
    checked_at: string | null;
  } | null;
  review_status: string;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  ai_summary: { summary: ExtractiveSummary; offence_mentions: OffenceMention[]; legal_references: LegalReference[] } | null;
}

export interface Entity {
  text: string;
  label: string;
  source_span: string;
}

export interface Statement {
  id: string;
  hearing_id: string;
  case_id: string | null;
  session_id: string | null;
  person_id: string;
  person_name: string | null;
  role: string;
  identity_verification: string;
  started_at: string | null;
  ended_at: string | null;
  transcript: string | null;
  transcript_source: string | null;
  transcript_status: string;
  transcript_language: string | null;
  live_segments?: { seq: number; text: string; language: string | null }[];
  extracted_entities: Entity[];
  summary?: ExtractiveSummary | null;
  offence_mentions?: OffenceMention[];
  sequence_number: number;
  recording_content_type?: string | null;
  recording_size_bytes?: number | null;
  has_recording?: boolean;
}

export interface CourtroomState {
  session: {
    id: string;
    hearing_id: string;
    case_id: string | null;
    active_statement_id: string | null;
    statements: string[];
    session_started_at: string;
    session_closed_at: string | null;
  };
  active_statement: Statement | null;
  statements: Statement[];
  stt: { available: boolean; loaded: boolean; model: string; error: string | null };
}

export interface Citation {
  source_title: string;
  article: string | null;
  article_label: string | null;
  url: string;
  effective_from: string | null;
  effective_to: string | null;
  jurisdiction: string;
  law_document_id: string | null;
  excerpt: string;
}

export type AnswerStatus = "ok" | "sources_only" | "ai_unavailable" | "ai_busy" | "discarded" | "no_sources" | "no_corpus" | "error";

/** Result of the grounding check: each drafted sentence and the sources that support it. */
export interface Grounding {
  sentences: {
    text: string;
    support: "supported" | "partial" | "unsupported" | "heading";
    score: number;
    sources: number[];
    /** Dates, times or amounts stated in the sentence that the sources do not contain. */
    invented_figures?: string[];
  }[];
  supported_ratio: number;
  method: string;
}

export interface KeyPassage {
  source_index: number;
  source_number: number;
  text: string;
  score: number;
}

export interface ResearchResult {
  status: "ok" | "no_corpus" | "error";
  question?: string;
  language?: "ar" | "en";
  answer: string;
  answer_status: AnswerStatus;
  citations: Citation[];
  key_passages: KeyPassage[];
  grounding?: Grounding | null;
  confidence: number;
  needs_human_review: boolean;
  review_reason: string | null;
  retrieval_sources: string[];
  model?: string | null;
}

/** Phase updates while the local model drafts (server-sent `status` events). */
export interface DraftStatus {
  phase: "retrieving" | "waiting" | "writing" | "checking";
  ahead?: number;
  model?: string;
}

export interface CaseBrief {
  case_id: string;
  sections: { kind: "case" | "evidence" | "statement"; label: string; label_ar: string; ref: string | null; sentences: string[]; method?: string }[];
  timeline: { date: string; description: string; source: string | null }[];
  offence_mentions: { offence: string; label_en: string; label_ar: string; sources: string[]; example: string }[];
  legal_references: LegalReference[];
  notes: string[];
  generated_at: string;
  disclaimer: string;
}

export interface BriefDraft {
  status: "ok" | "ai_unavailable" | "ai_busy" | "discarded" | "no_sources" | "error";
  draft: string;
  grounding?: Grounding;
  model?: string;
  unsupported?: number;
  reason: string;
}

export interface SimilarCase {
  case_id: string;
  case_number: string;
  title: string;
  status: string;
  case_type: string;
  relevance: number;
  meaning?: number | null;
  wording?: number | null;
  reason: string;
}

export interface SimilarCasesResponse {
  source: "elasticsearch" | "fallback";
  items: SimilarCase[];
  methods?: string[];
  meaning_model_warming?: boolean;
  note: string;
}

/** Free memory on the machine; models are skipped rather than loaded when it runs short. */
export interface MachineMemory {
  free_mb: number | null;
  writing_model_needs_mb: number;
  embeddings_need_mb: number;
  writing_model_loaded: boolean;
  can_start_writing_model: boolean;
}

export interface AIModelStatus {
  key: "embeddings" | "classifier" | "writer" | "speech_to_text" | "ner_en" | "ocr";
  name: string;
  runtime: string;
  available: boolean;
  loaded: boolean | null;
  error?: string | null;
  enabled?: boolean;
  in_use?: boolean;
  idle_seconds?: number | null;
  unloads_after_seconds?: number;
  load_seconds?: number | null;
  examples?: number;
  learned_examples?: number | null;
  memory_mb?: number;
  queue?: number;
  keep_alive?: string;
  model?: string;
}

export interface LawDocument {
  id: string;
  title: string;
  law_number: string | null;
  year: number | null;
  jurisdiction: string;
  language: string;
  effective_from: string | null;
  effective_to: string | null;
  legislation_state: string;
  source_url: string | null;
  original_filename: string;
  sha256: string;
  size_bytes: number;
  status: string;
  error: string | null;
  article_count: number | null;
  parse_mode: string | null;
  uploaded_by: string;
  uploaded_at: string;
  indexed_at: string | null;
}

export interface UserAccount {
  id: string;
  username: string;
  full_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface AuditEntry {
  id: number;
  at: string;
  user_id: string | null;
  username: string | null;
  role: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
}

export interface Analytics {
  generated_at: string;
  cases: {
    total: number;
    open: number;
    by_status: Record<string, number>;
    by_type: Record<string, number>;
    open_by_priority: Record<string, number>;
    needs_review: number;
    deadlines_next_14_days: number;
    overdue_deadlines: number;
    opened_per_week: { week_start: string; cases_opened: number }[];
  };
  hearings: { today: number; next_7_days: number };
  complaints: {
    total: number;
    by_status: Record<string, number>;
    by_category: Record<string, number>;
    awaiting_triage: number;
    ai_status: Record<string, number>;
    per_day_30: { date: string; complaints: number }[];
  };
  evidence: { total: number; pending_review: number; flagged: number; processing: number; failed: number };
  rulings: { total: number; avg_days_to_ruling: number | null };
  statements: { total: number | null };
  unavailable: string[];
}

export interface SearchHit {
  id: string;
  title: string;
  subtitle: string;
  snippet: string | null;
  case_id?: string | null;
  law_document_id?: string | null;
}

export interface SearchResponse {
  query: string;
  source: string;
  results: Record<string, SearchHit[]>;
}

export interface ServiceStatus {
  name: string;
  available: boolean;
  latency_ms?: number | null;
  error: string | null;
  detail?: string;
  loaded?: boolean;
  model?: string;
}
