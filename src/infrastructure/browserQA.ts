import { chromium, type Browser } from "playwright-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export type BrowserChannel = "chrome" | "msedge";
export interface BrowserReport {
  url: string;
  channel: BrowserChannel;
  title: string;
  errors: string[];
  durationMs: number;
  captured: boolean;
}
export function localBrowserUrl(value: string): string {
  const authority = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i;
  const url = new URL(value);
  if (!authority.test(value) || url.username || url.password)
    throw new Error("Browser QA requires an HTTP(S) loopback URL without credentials");
  return url.href;
}
export function browserRequestAllowed(value: string, origin: string): boolean {
  try {
    const url = new URL(value);
    return (
      ["data:", "blob:"].includes(url.protocol) ||
      (url.origin === origin &&
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password)
    );
  } catch {
    return false;
  }
}
export async function runBrowserQA(input: {
  url: string;
  channel: BrowserChannel;
  screenshot: string;
}): Promise<BrowserReport> {
  const url = localBrowserUrl(input.url);
  const origin = new URL(url).origin;
  const started = Date.now();
  const errors: string[] = [];
  const add = (message: string) => {
    if (errors.length < 80) errors.push(message.slice(0, 1500));
  };
  let browser: Browser | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let title = "";
  let captured = false;
  try {
    browser = await chromium.launch({ channel: input.channel, headless: true, timeout: 15_000 });
    const active = browser;
    timer = setTimeout(() => {
      add("Browser QA timed out");
      void active.close();
    }, 30_000);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    await context.route("**/*", async (route) => {
      const target = route.request().url();
      try {
        if (!browserRequestAllowed(target, origin)) {
          add(`Blocked request outside selected origin: ${target}`);
          await route.abort();
        } else if (["data:", "blob:"].includes(new URL(target).protocol)) {
          await route.continue();
        } else {
          const response = await route.fetch({ maxRedirects: 0, timeout: 10_000 });
          if (response.status() >= 300 && response.status() < 400 && response.headers().location) {
            add(`Redirect blocked: ${target}. Use the final application URL.`);
            await route.abort();
          } else await route.fulfill({ response });
          await response.dispose();
        }
      } catch (error) {
        add(
          `Request unavailable: ${target} (${error instanceof Error ? error.message : "unknown"})`,
        );
        await route.abort().catch(() => {});
      }
    });
    await context.routeWebSocket("**/*", (socket) => {
      const websocket = new URL(socket.url());
      websocket.protocol = websocket.protocol === "wss:" ? "https:" : "http:";
      if (browserRequestAllowed(websocket.href, origin)) socket.connectToServer();
      else {
        add(`Blocked WebSocket outside selected origin: ${socket.url()}`);
        socket.close();
      }
    });
    context.on("page", (page) => {
      if (context.pages().length > 1) void page.close();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on("console", (message) => {
      if (message.type() === "error") add(`Console: ${message.text()}`);
    });
    page.on("pageerror", (error) => add(`JavaScript: ${error.message}`));
    page.on("requestfailed", (request) =>
      add(`Request failed: ${request.url()} (${request.failure()?.errorText ?? "unknown"})`),
    );
    page.on("response", (response) => {
      if (response.status() >= 400) add(`HTTP ${response.status()}: ${response.url()}`);
    });
    page.on("dialog", (dialog) => {
      add(`Unexpected dialog: ${dialog.type()}`);
      void dialog.dismiss();
    });
    await page.goto(url, { waitUntil: "load", timeout: 15_000 });
    await page.waitForTimeout(1000);
    title = (await page.title()).slice(0, 500);
    if (!browserRequestAllowed(page.url(), origin)) add("Navigation left the selected origin");
    if (!(await page.locator("body").innerText()).trim()) add("Page body is empty");
    await mkdir(path.dirname(input.screenshot), { recursive: true });
    await page.screenshot({ path: input.screenshot, timeout: 10_000 });
    captured = true;
  } catch (error) {
    add(error instanceof Error ? error.message : "Browser QA unavailable");
  } finally {
    if (timer) clearTimeout(timer);
    await browser?.close().catch(() => {});
  }
  return { url, channel: input.channel, title, errors, durationMs: Date.now() - started, captured };
}
