# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, email the maintainer or use
GitHub's private vulnerability reporting on the repository. We will acknowledge and respond as
quickly as we can.

## Design notes

- Claudex runs **entirely on your machine**. It talks only to the model providers (Anthropic,
  OpenAI) and TypeSafe, using *your* credentials.
- Credentials are read from `~/.claude/.credentials.json` and `~/.codex/auth.json` by the **official
  SDKs**. Claudex never extracts or reuses OAuth tokens in third-party tools.
- API keys you enter in the app are written to the local `.env` file, which is git-ignored.
- Agents run in **isolated git worktrees**; changes reach your branch only when you click **Apply**.
- Logs redact known secret values.

## Never commit secrets

`.env`, `~/.claude/`, and `~/.codex/` must stay out of version control. If you believe a secret was
committed, rotate it immediately.
