# Contributing to Claudex

Install Node.js 22+, run `npm install`, then `npm run build`. Use `npm run app` for Electron or `npm run app:web` for the browser. Project folders do not require Git.

Validate changes with `npm run typecheck`, `npm run lint`, `npm test -- --maxWorkers=2 --minWorkers=1`, `npm run build` and `npm run ui:check`. The UI smoke requires installed Chrome and uses simulated agents with isolated data. Do not commit credentials, `.env`, generated builds or QA output.

- `src/application/sessionService.ts`: folder registrations, atomic session storage, routing, execution and cancellation.
- `src/application/sessionAgent.ts`: translates SDK events into public activity.
- `src/jev.ts`: model selection with validated Jev responses and explicit local fallback.
- `src/agents/`: official SDK adapters, resuming one persistent context per project and model in the selected folder.
- `src/application/agentTeam.ts`: automatic collaboration, scope reservations, messaging and cancellation; `projectMemory.ts` tracks changes without Git.
- `src/agents/teamBridge.ts`: the shared MCP tool bridge used by Claude and Codex.
- `src/server/sessionServer.ts`: local HTTP and WebSocket with host/origin validation.
- `src/chat/`: the single workspace screen, folder selection, account settings and themes.
- `desktop/`: Electron window and native folder picker.

See SPEC-simplification.md and README.pt-BR.md for the current contract. Other phase documents in docs/ are historical.
