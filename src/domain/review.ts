export type ReviewSeverity = "info" | "warning" | "error";

export interface ReviewFinding {
  severity: ReviewSeverity;
  message: string;
  file?: string;
  line?: number;
  rule?: string;
}

export interface Review {
  id: string;
  missionId: string;
  taskId?: string;
  approved: boolean;
  source: string;
  summary: string;
  findings: ReviewFinding[];
  at: number;
}
