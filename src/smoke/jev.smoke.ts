import { getConfig } from "../config.js";
import { JevClient } from "../jev.js";

const config = getConfig();
const jev = new JevClient(config);

if (!jev.enabled) {
  console.log("[jev smoke] TYPESAFE_API_KEY not set. Using heuristic fallback.");
  console.log(await jev.classifyComplexity("implementar login com Google"));
  console.log(await jev.shouldParallelize(["criar endpoint /health", "escrever teste do endpoint"]));
  process.exit(0);
}

console.log("[jev smoke] Noul question...");
const noul = await jev.decide("Help! My payouts have been failing for 3 days.", {
  is_urgent: { type: "noul", instructions: "Does this convey urgency?" },
});
console.log(JSON.stringify(noul, null, 2));

console.log("[jev smoke] classifyComplexity...");
console.log(await jev.classifyComplexity("implementar login com Google usando OAuth"));

console.log("[jev smoke] shouldParallelize...");
console.log(await jev.shouldParallelize(["criar endpoint /health", "documentar o endpoint"]));
