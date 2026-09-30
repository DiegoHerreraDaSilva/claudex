import { renderBrowserQA } from "./browserQA.js";
import { renderGitHub } from "./github.js";
import { el } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { currentConversation, currentDiff, isRunning, state } from "../lib/store.js";

const LABELS = {
  typecheck: "verifyTypecheck",
  build: "verifyBuild",
  tests: "verifyTests",
  lint: "verifyLint",
  security: "verifySecurity",
};
const ICONS = { passed: "✓", failed: "✕", skipped: "—", running: "◌" };

export function renderMissionResults(actions) {
  const host = el("div", { class: "mission-results" });
  const summary = state.missionSummary;
  if (state.missionSummaryError) {
    host.appendChild(el("div", { class: "empty", role: "alert", text: t("missionSummaryError") }));
    host.appendChild(
      el("button", {
        class: "ghost-btn",
        text: t("retry"),
        onclick: () => actions.reloadMissionSummary(),
      }),
    );
    return host;
  }
  host.appendChild(renderVerification(summary));
  host.appendChild(renderReview(summary, actions));
  host.appendChild(renderBrowserQA(actions));
  host.appendChild(renderGitHub(actions));
  if (summary?.status === "analysed") {
    host.appendChild(el("p", { text: t("manualAnalysis") }));
    return host;
  }
  if (summary && ["ready", "failed", "cancelled", "applied"].includes(summary.status))
    host.appendChild(renderCompletion(summary, actions));
  return host;
}

function renderVerification(summary) {
  const section = el("section", { class: "mc-section", "aria-label": t("verification") });
  section.appendChild(el("h2", { class: "section-label", text: t("verification") }));
  if (!summary?.verification?.length) {
    section.appendChild(el("div", { class: "empty", text: t("noVerification") }));
    return section;
  }
  for (const kind of Object.keys(LABELS)) {
    const run = summary.verification.find((item) => item.kind === kind);
    if (!run) continue;
    const details = el("details", { class: `verification-row ${run.status}`, dataset: { kind } });
    details.appendChild(
      el("summary", {}, [
        el("span", { class: "verification-icon", "aria-hidden": "true", text: ICONS[run.status] }),
        el("span", { class: "verification-label", text: t(LABELS[kind]) }),
        el("span", { class: "verification-status", text: t(run.status) }),
        el("span", {
          class: "verification-duration",
          text: run.durationMs === undefined ? "" : formatDuration(run.durationMs),
        }),
      ]),
    );
    details.appendChild(
      el("pre", {
        class: "verification-output",
        text: [run.summary, run.output].filter(Boolean).join("\n\n"),
      }),
    );
    section.appendChild(details);
  }
  return section;
}

function renderReview(summary, actions) {
  const section = el("section", { class: "mc-section", "aria-label": t("reviewFindings") });
  section.appendChild(el("h2", { class: "section-label", text: t("reviewFindings") }));
  const review = summary?.review;
  if (!review) {
    section.appendChild(el("div", { class: "empty", text: t("noReview") }));
    return section;
  }
  section.appendChild(
    el("div", { class: `review-verdict ${review.approved ? "passed" : "failed"}` }, [
      el("strong", {
        text: t(
          review.source === "unavailable"
            ? "reviewUnavailable"
            : review.approved
              ? "reviewApproved"
              : "reviewRejected",
        ),
      }),
      el("span", { class: "review-source", text: review.source }),
    ]),
  );
  section.appendChild(el("p", { class: "review-summary", text: review.summary }));
  for (const finding of review.findings) {
    section.appendChild(
      el("article", { class: `review-finding ${finding.severity}` }, [
        el("div", {
          class: "finding-location",
          text: [
            t(`severity${finding.severity[0].toUpperCase()}${finding.severity.slice(1)}`),
            finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ""}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        }),
        el("div", { class: "finding-message", text: finding.message }),
      ]),
    );
  }
  const hasIssues =
    !review.approved ||
    review.findings.length > 0 ||
    summary.verification.some((run) => run.status === "failed");
  if (hasIssues && !["applied", "cancelled"].includes(summary.status)) {
    section.appendChild(
      el("button", {
        class: "ghost-btn",
        text: t("fixAutomatically"),
        disabled: isRunning(summary.id),
        onclick: () => actions.fixAutomatically(),
      }),
    );
  }
  return section;
}

function renderCompletion(summary, actions) {
  const titles = {
    ready: "missionComplete",
    failed: "missionNeedsCorrection",
    cancelled: "missionCancelled",
    applied: "missionApplied",
  };
  const card = el("section", {
    class: `mission-complete ${summary.status}`,
    "aria-label": t(titles[summary.status]),
  });
  card.appendChild(el("h2", { class: "mission-complete-title", text: t(summary.verification.some((run) => run.status === "failed") ? "missionNeedsCorrection" : titles[summary.status]) }));
  const tests = summary.verification.find((run) => run.kind === "tests");
  const metrics = el("div", { class: "completion-metrics" }, [
    el("span", {
      text: `${summary.files.length} ${t("tabFiles")} · +${summary.additions} / −${summary.deletions}`,
    }),
    el("span", {
      text: `${t("verifyTests")}: ${tests ? t(tests.status) : "—"}${tests?.testCount === undefined ? "" : ` (${tests.testCount})`}`,
    }),
    el("span", {
      text: `${t("checksSkipped")}: ${summary.verification.filter((run) => run.status === "skipped").length}`,
    }),
    el("span", { text: `${t("costShort")}: ~$${summary.costUsd.toFixed(4)}` }),
    el("span", {
      text: `${t("duration")}: ${formatDuration((summary.finishedAt ?? summary.updatedAt) - summary.startedAt)}`,
    }),
  ]);
  card.appendChild(metrics);
  if (summary.error && summary.status === "failed")
    card.appendChild(
      el("details", {}, [
        el("summary", { text: t("failed") }),
        el("pre", { class: "verification-output", text: summary.error }),
      ]),
    );
  if (["ready", "failed"].includes(summary.status)) {
    const canAct =
      currentConversation()?.autonomy !== "manual" &&
      !isRunning(summary.id) &&
      (currentDiff()?.files?.length ?? 0) > 0;
    card.appendChild(
      el("div", { class: "completion-actions" }, [
        el("button", {
          class: "ghost-btn",
          text: t("reviewChanges"),
          onclick: () => actions.reviewChanges(),
        }),
        el("button", {
          class: "primary-btn",
          text: t("apply"),
          disabled: !canAct || summary.status !== "ready" || summary.verification.some((run) => ["failed", "running"].includes(run.status)),
          onclick: () => actions.chatAction("apply"),
        }),
        el("button", {
          class: "ghost-btn",
          text: t("discard"),
          disabled: !canAct,
          onclick: () => actions.chatAction("discard"),
        }),
      ]),
    );
  }
  return card;
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
