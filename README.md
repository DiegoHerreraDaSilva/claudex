# Claudex

Fleet orchestrator that routes development subtasks across **Claude Code**, **Codex** and the
**Jev (TypeSafe)** decision API, runs each agent in an isolated git worktree, reviews the result
and merges it back — all streamed live to a terminal-style web dashboard.

```
description ──▶ Jev classifies complexity ──▶ route to agent ──▶ isolated worktree
                                                                    │
                            review (Opus + Jev noul) ◀── diff ◀──────┘
                                                                    │
                                            merge into base branch ◀─┘
```

## Routing

| Jev complexity | Agent | Model (default) |
| --- | --- | --- |
| `fast` / `balanced` | Claude Code (Agent SDK) | `sonnet` |
| `strong` | Codex SDK | `gpt-6-sol` |
| `judgment` | Claude Code (Agent SDK) | `opus` |

If the Jev API is unavailable (missing key, 429/529/5xx), the orchestrator falls back to a local
heuristic router, so the fleet never stalls (`src/jev.ts:heuristicComplexity`).

## Requirements

- Node.js **22+** (the Claude Agent SDK bundles a native Claude Code binary)
- git with `worktree` support
- A Claude Pro/Max subscription and a ChatGPT Plus/Pro subscription
- A TypeSafe API key (early access): https://console.typesafe.ai/keys

## Install & build

```bash
npm install
npm run build
```

## Authentication

The official SDKs read subscription credentials from disk — no API keys are needed for the models:

- Claude: `~/.claude/.credentials.json`, created by `claude login`
- Codex: `~/.codex/auth.json`, created by `codex login` → "Sign in with ChatGPT"

> **Important:** if `ANTHROPIC_API_KEY` is set, the Anthropic SDK uses it and **ignores the
> subscription** (token billing). `checkPrerequisites()` warns you when that variable is present.
> The Claude init message exposes `apiKeySource`, so agents can detect it at runtime too.

Copy `.env.example` to `.env` and set `TYPESAFE_API_KEY`. The orchestrator also loads `.env`
automatically at startup.

## CLI

```bash
claudex run "<description>"   # full flow: route, execute, review, merge
claudex dashboard             # WS + HTTP dashboard on http://localhost:8080 (works while idle)
claudex app                   # desktop chat app (projects + continuous sessions)
claudex status                # print the fleet snapshot
claudex worktrees             # list active worktrees
claudex clean                 # remove orphan worktrees and branches
```

Options for `run`:

| Flag | Effect |
| --- | --- |
| `--subtasks <json>` | Split the work manually, e.g. `'["a","b"]'` or `'[{"id":"auth","description":"..."}]'` |
| `--cleanup` | Remove worktrees after finishing |
| `--dry-run` | Ask Jev for routing only; run no agents |
| `--no-server` | Do not start the dashboard during the run |

`claudex run` starts the dashboard in the same process, so the browser updates live.

## Example

```
$ claudex run "adicionar endpoint /health" --subtasks '["criar rota /health", "documentar /health no README"]'

Prerequisites
  ok   git repository - git repository detected at ~/projeto
  ok   git worktree - git worktree is available
  ok   Claude subscription - credentials found at ~/.claude/.credentials.json
  ok   Codex subscription - credentials found at ~/.codex/auth.json
  ok   TYPESAFE_API_KEY - configured (endpoint https://api.typesafe.ai)

dashboard: http://localhost:8080  (ws + http on the same port)
[task] created 4f2a1c0e :: criar rota /health
[task] created 91bd77aa :: documentar /health no README
[jev] 4f2a1c0e -> claude:sonnet (fast, conf 0.87, jev)
[jev] 91bd77aa -> claude:sonnet (fast, conf 0.81, jev)
[run] 4f2a1c0e worktree=/home/me/projeto/.worktrees/4f2a1c0e
[run] 91bd77aa worktree=/home/me/projeto/.worktrees/91bd77aa
[done] 4f2a1c0e in 34.2s, 41 diff lines
[done] 91bd77aa in 12.8s, 9 diff lines

claude:sonnet      completed   4f2a1c0e criar rota /health
  complexity=fast turns=6 in=18422 out=1203 files=2
claude:sonnet      completed   91bd77aa documentar /health no README
  complexity=fast turns=4 in=9120 out=640 files=1

Fleet complete. merged=2/2
Dashboard still running. Press Ctrl+C to exit.
```

## Dashboard (ASCII)

```
┌──────────────────────────┬─────────────────────────────────────────────┬────────────────────────────┐
│ ● Claudex                │ claude:sonnet   turn 6  in 18422  out 1203   │ sessions │ diff │ status   │
│ 2 tasks        parallel  │ cache 0%  status running                     │                            │
├──────────────────────────┼─────────────────────────────────────────────┼────────────────────────────┤
│ ● 4f2a1c0e criar rota... │  1 init session=7c1f… model=sonnet           │ 4f2a1c0e claude:sonnet     │
│   [claude:sonnet][running]│  2 Vou criar a rota /health em src/server.. │ session_id 7c1f…           │
│   ▓▓▓▓▓░░░░░ ctx          │  3 ┌ Read src/server/app.ts                  │ status   running           │
│   ▓▓░░░░░░░░ cache        │  4 │ Write src/server/health.ts              │ duration 34.2s             │
│   src/server/health.ts    │  5 └ Edit src/server/app.ts                 │ 91bd77aa claude:sonnet     │
│ ● 91bd77aa documentar...  │  6 Rota adicionada e registrada no router.  │ session_id 2ab9…           │
│   [claude:sonnet][deciding]│  7 ✓ Review approved (noul=0.913)          │                            │
├──────────────────────────┼─────────────────────────────────────────────┼────────────────────────────┤
│ model sonnet │ turn 6   │ tokens 18422/1203 │ latency 34.2s │ running  │                            │
│ > pause | resume | kill <taskId>                                       │                            │
└──────────────────────────┴─────────────────────────────────────────────┴────────────────────────────┘
```

- Left sidebar: one card per task (pulsing LED = running, amber = waiting, red = error, blue = done),
  model badge, context/cache bars and files touched.
- Center: agent pill, turn/token/cache metrics, a numbered terminal with tool calls as side blocks,
  a telemetry bar and a command input (`pause`, `resume`, `kill <taskId>`).
- Right panel: **sessions** (`session_id` / `thread_id`), **diff** viewer, **status** summary.

## Resuming sessions

Every agent run returns a resumable handle, stored on the task snapshot:

- Claude → `session_id` (from the SDK init message). Resume with `options.resume`.
- Codex → `thread_id` (from the `thread.started` event). Resume with `codex.resumeThread(id)`.

The reviewer triggers one automatic correction round: if a diff is rejected, the orchestrator
resumes the same Claude session or Codex thread with the list of issues, then re-diffs and
re-reviews. The handles are visible in the dashboard's **sessions** tab and in the persisted
`tasks/*/*.json` snapshots.

## Project layout

```
src/
  index.ts            CLI entry point
  orchestrator.ts     Orchestrator (3-phase flow, typed event emitter)
  jev.ts              TypeSafe Jev client (retry, cache, heuristic fallback)
  worktree.ts         Git worktree manager (spawn git only)
  prerequisites.ts    checkPrerequisites()
  config.ts           env + .env loader
  events.ts           shared types + TypedEmitter
  agents/
    types.ts          AgentSpec, AgentRunResult, routing
    claude.ts         Claude Agent SDK wrapper
    codex.ts          Codex SDK wrapper
  server/
    ws.ts             WebSocket server (snapshot, broadcast, commands)
    static.ts         HTTP server (/health, /api/state, dashboard)
  dashboard/          index.html, style.css, app.js (no framework)
  smoke/              smoke tests
tasks/               persisted snapshots (pending/current/complete)
.worktrees/          temporary worktrees (gitignored)
```

## Smoke tests

```bash
npm run smoke:jev        # one Noul question (or heuristic fallback without a key)
npm run smoke:worktree   # create → diff → list → remove
SMOKE_AGENTS=1 npm run smoke:agents   # real Claude + Codex runs (uses your subscriptions)
```

## Notes on API contracts (verified)

- **Claude**: the TypeScript SDK is `@anthropic-ai/claude-agent-sdk`. The older
  `@anthropic-ai/claude-code` package is now only the CLI installer and does **not** export
  `query()`. `query({ prompt, options })` matches the documented API (`model`, `allowedTools`,
  `maxTurns`, `cwd`, `resume`, `outputFormat`).
- **Codex**: `@openai/codex-sdk` exports `Codex`, `Thread`, `ThreadEvent`. Streamed event types are
  `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.started`,
  `item.updated`, `item.completed`, `error` (there is **no** `item.created`). The worktree path is
  passed via `startThread({ workingDirectory })`.
- **Jev**: `POST {TYPESAFE_BASE_URL}/v1/systemone` with `{ state, model, questions }` returns
  `{ model, answers, usage }`. A Noul answer is `{ type: "noul", noul }` — it has **no**
  `confidence` (unlike Choice/Score). Score answers also carry a `legend`. Retries cover `429` and
  `529`. Input costs $0.042/MTok; output is free.
- **Structured output**: `zod-to-json-schema` is incompatible with the Agent SDK peer dependency on
  `zod@^4`, so this project uses the built-in `z.toJSONSchema()` instead.
