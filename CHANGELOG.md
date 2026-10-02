# Changelog

## [Unreleased]

- Add file selection, pasted images and drag-and-drop attachments to requests, with previews, removal, persisted references and native image inputs for Claude/Codex; share reference paths with collaborators.

- Keep effort selectors populated when an older running backend omits the effort catalog.

- Add persistent per-role effort selectors for Planner, Simple and Complex, apply them to main agents and routed collaborators through the Claude/Codex SDKs, and preserve sessions when only effort changes.

- Add closable session tabs named by agent role and model, context occupancy/limit indicators, summary-based context compaction with failure recovery, and persistent input/projects/chat splitters; remove the request field's focus border.

- Render sanitized Markdown in agent responses with readable headings, lists, tables and copyable code blocks; display basic ANSI colors in terminal/tool output without escape-code artifacts.

- Replace the app icon (taskbar, window, installer and `Claudex.exe`) and generate it with `scripts/make-icon.mjs`; remove the native menu bar on Windows and Linux.
- Fix packaged installs failing to start Claude/Codex by running their binaries from `app.asar.unpacked`.
- Tell agents not to end processes by name, so they cannot close Claudex.
- Add a right-aligned project Terminal tab with persistent PowerShell/Bash shells, live output, command recall, clear/stop controls and application shutdown cleanup.

- Fix Jev HTTPS certificate trust using system CAs in Node and Chromium networking in Electron; report specific fallback causes without exposing API keys.
- Deduplicate matching SDK messages and final results, including existing displayed history.
- Share project memory, agent messages and filesystem change inventories across model sessions without Git.
- Add automatic MCP collaboration, concurrent helpers, nested delegation, write-scope reservations and team cancellation.
- Allow provider/model selection for every agent role, persisted and applied to subsequent requests and collaborators.
- Replace mission, schedule and Git/worktree flows with persistent routed agent sessions editing any local folder directly.
- Simplify the interface to a top request field, project sidebar, agent session tabs and live activity.
- Preserve legacy data, import folder registrations and keep settings writable in packaged installations.
- Validate local HTTP/WebSocket origins; block simultaneous edits in overlapping folders.

## [0.2.0] - 2026-10-01

### Added

- Working assistant, task and local schedule screens, including persistent requests, supervised execution, filtering and schedule history.
- Guided onboarding, narrow-window navigation and simpler Portuguese/English wording.
- Mission verification/review, project tools, autonomy policies, GitHub PR/CI and Chrome/Edge page-load QA.

### Changed

- Softer graphite and gray themes; technical settings and usage details are collapsed.

### Fixed

- Draft text survives background interface updates.
- Scheduled requests avoid duplicate execution and handle interrupted work without automatic relaunch.
- Applying changes checks the verified and reviewed commit.
