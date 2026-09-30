import { app, BrowserWindow } from "electron";

/**
 * Headless UI smoke check: loads the Claudex chat UI in Electron, captures
 * console messages / failed loads and probes the DOM. Exits non-zero when the
 * renderer logs an error or the page fails to load.
 *
 * Usage (server must be running):
 *   npx electron scripts/ui-check.mjs http://127.0.0.1:8080
 *   npm run ui:check -- http://127.0.0.1:8080
 */
const url = process.argv[2] || process.env.CLAUDEX_UI_URL || "http://127.0.0.1:8080";
const waitMs = Number(process.env.CLAUDEX_UI_WAIT || 4500);
const logs = [];
let failed = false;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 860 });
  win.webContents.on("console-message", (...args) => {
    let level;
    let message;
    if (args.length === 1 && typeof args[0] === "object") {
      level = args[0].level;
      message = args[0].message;
    } else {
      level = args[1];
      message = args[2];
    }
    const tag = typeof level === "number" ? level : String(level).toLowerCase();
    logs.push(`[console:${tag}] ${message}`);
    if (tag === 3 || tag === "error") failed = true;
  });
  win.webContents.on("did-fail-load", (_event, code, desc, failedUrl) => {
    failed = true;
    logs.push(`[fail-load] ${code} ${desc} ${failedUrl}`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    failed = true;
    logs.push(`[gone] ${JSON.stringify(details)}`);
  });

  try {
    await win.loadURL(url);
  } catch (err) {
    failed = true;
    logs.push(`[load-error] ${err.message}`);
  }

  await new Promise((resolve) => setTimeout(resolve, waitMs));

  try {
    const probe = await win.webContents.executeJavaScript(`({
      brand: !!document.querySelector('.brand-name'),
      sidebarGroups: document.querySelectorAll('#sidebar-nav .nav-group').length,
      centerHtml: document.getElementById('view-host')?.children.length ?? 0,
      palette: !!document.getElementById('palette'),
      theme: document.documentElement.getAttribute('data-theme')
    })`);
    logs.push(`[probe] ${JSON.stringify(probe)}`);
  } catch (err) {
    failed = true;
    logs.push(`[probe-error] ${err.message}`);
  }

  console.log(logs.join("\n"));
  console.log(failed ? "[result] FAIL" : "[result] OK");
  app.exit(failed ? 1 : 0);
});

app.on("window-all-closed", () => app.exit(failed ? 1 : 0));
