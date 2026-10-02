import { Agent } from "node:https";
import * as tls from "node:tls";
import axios from "axios";
let nodeAgent: Agent | undefined;
function trustedAgent(): Agent {
  if (!nodeAgent) {
    const certificates =
      typeof tls.getCACertificates === "function"
        ? [...tls.getCACertificates("default"), ...tls.getCACertificates("system")]
        : [...tls.rootCertificates];
    nodeAgent = new Agent({ ca: [...new Set(certificates)], rejectUnauthorized: true });
  }
  return nodeAgent;
}
export async function postJev(url: string, body: unknown, apiKey: string, signal?: AbortSignal) {
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  if (process.versions.electron) {
    // Chromium honors OS certificate trust and proxy configuration in desktop mode.
    const { net } = await import("electron");
    const timeout = AbortSignal.timeout(30000);
    const response = await net.fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    return {
      status: response.status,
      data: await response.json(),
      headers: { "retry-after": response.headers.get("retry-after") },
    };
  }
  return axios.post(url, body, {
    headers,
    signal,
    timeout: 30000,
    httpsAgent: trustedAgent(),
    validateStatus: () => true,
  });
}
