export type VerificationKind = "typecheck" | "build" | "tests" | "lint" | "security" | "browser";

export type VerificationStatus = "running" | "passed" | "failed" | "skipped";

export interface VerificationRun {
  id: string;
  missionId: string;
  kind: VerificationKind;
  status: VerificationStatus;
  summary: string;
  output?: string;
  durationMs?: number;
  testCount?: number;
  at: number;
  screenshot?: string;
  head?: string;
}
