import { useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { api } from "./client";
import type {
  AIModelStatus, Analytics, MachineMemory, AuditEntry, CaseBrief, CaseDetailResponse, CaseParty, CaseSummary, Complaint, CourtroomState,
  Evidence, Hearing, LawDocument, Paged, SearchResponse, ServiceStatus, SimilarCasesResponse, Statement,
  UserAccount,
} from "./types";

function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!entries.length) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

type Opts<T> = Omit<UseQueryOptions<T>, "queryKey" | "queryFn">;

// --- Cases -----------------------------------------------------------------

export interface CaseFilters {
  status?: string;
  case_type?: string;
  priority?: string;
  q?: string;
  open_only?: boolean;
  mine?: boolean;
  limit?: number;
  offset?: number;
}

export const useCases = (filters: CaseFilters = {}, opts?: Opts<Paged<CaseSummary>>) =>
  useQuery({ queryKey: ["cases", filters], queryFn: () => api.get<Paged<CaseSummary>>(`/cases${qs({ ...filters })}`), ...opts });

export const useCase = (id: string | undefined) =>
  useQuery({ queryKey: ["case", id], queryFn: () => api.get<CaseDetailResponse>(`/cases/${id}`), enabled: !!id });

export const useCaseParties = (id: string | undefined) =>
  useQuery({ queryKey: ["case", id, "parties"], queryFn: () => api.get<CaseParty[]>(`/cases/${id}/parties`), enabled: !!id });

export const useCaseEvidence = (id: string | undefined, poll = false) =>
  useQuery({
    queryKey: ["case", id, "evidence"],
    queryFn: () => api.get<Evidence[]>(`/cases/${id}/evidence`),
    enabled: !!id,
    refetchInterval: (q) =>
      poll || (q.state.data ?? []).some((e) => ["queued", "processing"].includes(e.processing_status)) ? 4000 : false,
  });

export const useCaseStatements = (id: string | undefined) =>
  useQuery({
    queryKey: ["case", id, "statements"],
    queryFn: () => api.get<Statement[]>(`/cases/${id}/statements`),
    enabled: !!id,
    retry: 1,
    refetchInterval: (q) =>
      (q.state.data ?? []).some((s) => ["queued", "processing"].includes(s.transcript_status)) ? 5000 : false,
  });

export const useResearchNotes = (id: string | undefined) =>
  useQuery({ queryKey: ["case", id, "notes"], queryFn: () => api.get<any[]>(`/cases/${id}/research-notes`), enabled: !!id });

export const useSimilarCases = (id: string | undefined) =>
  useQuery({ queryKey: ["case", id, "similar"], queryFn: () => api.get<SimilarCasesResponse>(`/cases/${id}/similar`), enabled: !!id });

export const useCaseBrief = (id: string | undefined) =>
  useQuery({ queryKey: ["case", id, "brief"], queryFn: () => api.get<CaseBrief>(`/cases/${id}/brief`), enabled: !!id });

export const useRelatedCases = (id: string | undefined) =>
  useQuery({ queryKey: ["case", id, "related"], queryFn: () => api.get<any>(`/cases/${id}/related`), enabled: !!id });

export const useCaseAudit = (id: string | undefined, enabled = true) =>
  useQuery({
    queryKey: ["case", id, "audit"],
    queryFn: () => api.get<Paged<AuditEntry>>(`/cases/${id}/audit`),
    enabled: !!id && enabled,
  });

// --- Hearings --------------------------------------------------------------

export const useHearings = (params: { day?: string; start?: string; end?: string; case_id?: string; mine?: boolean }) =>
  useQuery({
    queryKey: ["hearings", params],
    queryFn: () => api.get<Hearing[]>(`/hearings${qs(params)}`),
    refetchInterval: 60_000,
  });

export const useJudges = () =>
  useQuery({
    queryKey: ["judges"],
    queryFn: () => api.get<{ id: string; full_name: string }[]>("/auth/judges"),
    staleTime: 5 * 60_000,
  });

// --- Complaints --------------------------------------------------------------

export const useComplaints = (filters: { status?: string; case_type?: string; q?: string }) =>
  useQuery({
    queryKey: ["complaints", filters],
    queryFn: () => api.get<Paged<Complaint>>(`/complaints${qs({ ...filters, limit: 200 })}`),
    refetchInterval: (q) => ((q.state.data?.items ?? []).some((c) => c.ai_status === "pending") ? 4000 : 30_000),
  });

// --- Courtroom -----------------------------------------------------------------

export const useCourtroomSession = (sessionId: string | undefined) =>
  useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => api.get<CourtroomState>(`/courtroom/sessions/${sessionId}`),
    enabled: !!sessionId,
    refetchInterval: (q) =>
      (q.state.data?.statements ?? []).some((s) => ["queued", "processing"].includes(s.transcript_status)) ? 5000 : false,
  });

// --- Research / library --------------------------------------------------------

export const useLibrary = () =>
  useQuery({
    queryKey: ["library"],
    queryFn: () => api.get<LawDocument[]>("/library/documents"),
    refetchInterval: (q) => ((q.state.data ?? []).some((d) => ["queued", "processing"].includes(d.status)) ? 4000 : false),
  });

export const useLibraryStats = () =>
  useQuery({ queryKey: ["library", "stats"], queryFn: () => api.get<any>("/library/stats") });

// --- Insights / admin ----------------------------------------------------------

export const useAnalytics = () =>
  useQuery({
    queryKey: ["analytics"],
    queryFn: () => api.get<Analytics>("/analytics/overview"),
    refetchInterval: 60_000,
  });

export const useSearch = (q: string) =>
  useQuery({
    queryKey: ["search", q],
    queryFn: () => api.get<SearchResponse>(`/search${qs({ q })}`),
    enabled: q.trim().length >= 2,
    staleTime: 15_000,
  });

export const useSystemStatus = () =>
  useQuery({
    queryKey: ["admin", "system"],
    queryFn: () => api.get<{ services: ServiceStatus[]; ai_models: AIModelStatus[]; memory: MachineMemory; storage: any; corpus: any; fallbacks: Record<string, string> }>(
      "/admin/system"
    ),
    refetchInterval: 30_000,
  });

export const useAudit = (filters: { action?: string; username?: string; entity_type?: string; offset?: number }) =>
  useQuery({
    queryKey: ["admin", "audit", filters],
    queryFn: () => api.get<Paged<AuditEntry>>(`/admin/audit${qs({ ...filters, limit: 50 })}`),
  });

export const useUsers = () => useQuery({ queryKey: ["admin", "users"], queryFn: () => api.get<UserAccount[]>("/auth/users") });

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: unknown[][]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
}
