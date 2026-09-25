export type SystemRole = "judge" | "prosecutor" | "clerk" | "case_officer" | "admin";

const ALL: SystemRole[] = ["judge", "prosecutor", "clerk", "case_officer", "admin"];

/** Mirrors backend/app/api/deps.py role groups. The backend is the authority; this only hides buttons that would 403. */
export const can = {
  createCase: (r?: string) => ["case_officer", "clerk", "admin"].includes(r ?? ""),
  editCase: (r?: string) => ["case_officer", "clerk", "admin", "judge"].includes(r ?? ""),
  editCaseDetails: (r?: string) => ["case_officer", "clerk", "admin"].includes(r ?? ""),
  triageComplaints: (r?: string) => ["case_officer", "clerk", "admin"].includes(r ?? ""),
  uploadEvidence: (r?: string) => ["case_officer", "clerk", "prosecutor", "admin"].includes(r ?? ""),
  runStand: (r?: string) => ["clerk", "judge"].includes(r ?? ""),
  schedule: (r?: string) => ["clerk", "case_officer", "judge", "admin"].includes(r ?? ""),
  manageLibrary: (r?: string) => ["clerk", "case_officer", "prosecutor", "judge", "admin"].includes(r ?? ""),
  deleteLibrary: (r?: string) => ["clerk", "case_officer", "admin"].includes(r ?? ""),
  enterRuling: (r?: string) => r === "judge",
  viewCaseAudit: (r?: string) => ["judge", "clerk", "admin", "case_officer"].includes(r ?? ""),
  admin: (r?: string) => r === "admin",
  anyStaff: (r?: string) => ALL.includes((r ?? "") as SystemRole),
};
