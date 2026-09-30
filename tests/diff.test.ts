import { describe, it, expect } from "vitest";
import { diffStats, parseDiffFiles } from "../src/domain/diff.ts";

const DIFF = [
  "diff --git a/src/auth/token.ts b/src/auth/token.ts",
  "index 111..222 100644",
  "--- a/src/auth/token.ts",
  "+++ b/src/auth/token.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "diff --git a/src/api/users.ts b/src/api/users.ts",
  "index 333..444 100644",
  "--- a/src/api/users.ts",
  "+++ b/src/api/users.ts",
].join("\n");

describe("parseDiffFiles", () => {
  it("extracts changed file paths", () => {
    expect(parseDiffFiles(DIFF)).toEqual(["src/auth/token.ts", "src/api/users.ts"]);
  });

  it("returns an empty list for an empty diff", () => {
    expect(parseDiffFiles("")).toEqual([]);
  });
});

it("counts only hunk lines including content beginning with repeated plus signs", () => {
  const diff = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,2 @@\n-before\n+after\n+++content";
  expect(diffStats(diff)).toEqual({ additions: 2, deletions: 1 });
});
