export interface PullRequest {
  number: number;
  url: string;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  isCrossRepository: boolean;
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
}
export interface CiCheck {
  name: string;
  bucket: "pass" | "fail" | "pending" | "skipping" | "cancel";
  state: string;
  link: string;
  workflow?: string;
}
export interface CiSnapshot {
  pullRequest: PullRequest;
  checks: CiCheck[];
  status: "passed" | "failed" | "pending" | "none" | "skipped";
  headMatchesReview: boolean;
  checkedAt: number;
}
