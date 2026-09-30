import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runBrowserQA } from "../dist/infrastructure/browserQA.js";
const output = path.resolve(".claudex/qa/browser");
await mkdir(output, { recursive: true });
let externalHits = 0;
const other = createServer((_req, res) => {
  externalHits++;
  res.end("unexpected");
});
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  if (req.url === "/redirect") {
    res.writeHead(302, { Location: `http://127.0.0.1:${other.address().port}/` });
    res.end();
    return;
  }
  if (req.url === "/server-error") res.statusCode = 500;
  const script =
    req.url === "/broken"
      ? '<script>throw new Error("fixture JavaScript failure")</script>'
      : req.url === "/external"
        ? `<script src="http://127.0.0.1:${other.address().port}/foreign.js"></script>`
        : "";
  res.end(
    `<!doctype html><html><head><title>Browser QA fixture</title><link rel="icon" href="data:,"><style>body{font:18px system-ui;background:#102030;color:#e9eef6;margin:60px}main{padding:32px;border:1px solid #40566d;border-radius:12px}h1{color:#75dfbd}</style></head><body><main><h1>Claudex Browser QA</h1><p>Aplicativo local carregado no navegador instalado.</p><button>Exemplo</button></main>${script}</body></html>`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
await new Promise((resolve) => other.listen(0, "127.0.0.1", resolve));
const reports = [];
try {
  for (const channel of ["chrome", "msedge"]) {
    for (const route of ["/", "/broken", "/server-error", "/external", "/redirect"]) {
      const report = await runBrowserQA({
        url: `http://127.0.0.1:${server.address().port}${route}`,
        channel,
        screenshot: path.join(output, `${channel}-${route.replaceAll("/", "") || "passed"}.png`),
      });
      if (route === "/") {
        assert.deepEqual(report.errors, []);
        assert.equal(report.captured, true);
        assert.equal(report.title, "Browser QA fixture");
      } else assert.ok(report.errors.length, `${channel} ${route} should fail`);
      reports.push(report);
      console.log(
        JSON.stringify({ channel, route, captured: report.captured, errors: report.errors.length }),
      );
    }
  }
  assert.equal(externalHits, 0, "foreign origin must never receive a request");
  await writeFile(path.join(output, "report.json"), JSON.stringify(reports, null, 2));
  console.log(
    JSON.stringify({
      status: "passed",
      browsers: ["chrome", "msedge"],
      checks: 10,
      externalHits,
      output,
    }),
  );
} finally {
  await Promise.all([
    new Promise((resolve) => server.close(resolve)),
    new Promise((resolve) => other.close(resolve)),
  ]);
}
