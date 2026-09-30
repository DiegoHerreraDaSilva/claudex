import { repositoryFiles } from "./repoIntelligence.js";
export async function searchRepository(root: string, query: string) {
  if (typeof query !== "string" || !query.trim() || query.length > 500)
    throw new Error("query must contain 1–500 characters");
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_$.-]+/gu) ?? [])].slice(0, 20);
  if (!terms.length) throw new Error("query needs searchable words");
  const scan = await repositoryFiles(root);
  const matches: { file: string; line: number; snippet: string; score: number }[] = [];
  for (const file of scan.files) {
    for (const [index, line] of file.text.split(/\r?\n/).entries()) {
      const lower = line.toLowerCase();
      const hits = terms.filter((term) => lower.includes(term));
      if (!hits.length) continue;
      const symbol = file.symbols.some(
        (name) =>
          terms.includes(name.toLowerCase()) &&
          new RegExp(
            `\\b(?:function|class|interface|type|def|fn|const)\\s+${name.replace(/[$]/g, "\\$")}\\b`,
          ).test(line),
      );
      matches.push({
        file: file.file,
        line: index + 1,
        snippet: line.trim().slice(0, 400),
        score: hits.length / terms.length + (symbol ? 0.5 : 0),
      });
    }
  }
  matches.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);
  return {
    matches: matches.slice(0, 40),
    confidence: matches.length ? Math.min(1, matches[0].score / 1.5) : 0,
    truncated: scan.truncated || matches.length > 40,
    method: "lexical",
  };
}
