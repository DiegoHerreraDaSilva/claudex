# Security Policy

Report security problems privately to the maintainer or through GitHub private vulnerability reporting.

Claudex runs locally and calls Anthropic, OpenAI and TypeSafe with the user's configured credentials. Authentication is performed by the official SDKs and CLIs. API keys saved through the interface are stored in the application data directory. Never commit credentials or .env files.

Agents edit the selected folder directly. The application does not provide worktree isolation, rollback, review or an Apply step. Stopping an agent does not revert completed edits. Overlapping projects cannot run independent teams simultaneously. Members of the same team can collaborate in parallel. Codex uses its workspace-write sandbox; Claude uses SDK permissions for unattended execution. Folder scope is also included in the agent prompt.

The HTTP server binds to loopback and validates local host and browser origin. WebSocket clients receive activity only; execution and settings use validated HTTP inputs. UI output is rendered as text, without interpreting model-generated HTML. Legacy data remains preserved on disk and old executions and schedules are not relaunched.

Automatic teams communicate through a private loopback bridge with random per-member bearer tokens with team-scoped lifetimes. Tools validate member identity, active state, input sizes, delegation depth, concurrency, descendant waits and canonical project paths. A member cannot delegate writes outside its assigned scope or reuse a peer's reserved write scope. Reservations are cooperative coordination, not a filesystem sandbox per file. Read-only collaborators use the Codex read-only sandbox or disabled Claude write/shell tools. These protections do not isolate arbitrary third-party MCP tools configured by a user. All agents receive shared memory as historical data and are instructed to inspect current files. Stopping any team member aborts all its collaborators. The application stores shared memory and inventory in its data directory; the inventory never injects file contents into prompts.
