import { describe, expect, it } from "vitest";
import { localBrowserUrl, browserRequestAllowed } from "../src/infrastructure/browserQA.js";

describe("Browser QA network boundary", () => {
  it("accepts explicit loopback HTTP URLs and rejects remote, credentialed and ambiguous hosts", () => {
    expect(localBrowserUrl("http://localhost:3000/path")).toBe("http://localhost:3000/path");
    expect(localBrowserUrl("https://[::1]:8443/")).toBe("https://[::1]:8443/");
    for (const url of [
      "https://github.com",
      "file:///C:/secret",
      "http://user:pass@localhost:3000",
      "http://127.1",
      "http://2130706433",
      "http://localhost.evil.com",
      "http://0.0.0.0",
    ]) {
      expect(() => localBrowserUrl(url)).toThrow();
    }
  });
  it("limits browser requests to the selected origin and local inline resources", () => {
    const origin = "http://localhost:3000";
    expect(browserRequestAllowed("http://localhost:3000/api", origin)).toBe(true);
    expect(browserRequestAllowed("data:image/png;base64,AA", origin)).toBe(true);
    expect(browserRequestAllowed("http://localhost:8080/api", origin)).toBe(false);
    expect(browserRequestAllowed("https://example.com/font.woff", origin)).toBe(false);
    expect(browserRequestAllowed("file:///secret", origin)).toBe(false);
  });
});
