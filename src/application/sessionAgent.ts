import { runClaudeAgent } from "../agents/claude.js";
import { runCodexAgent } from "../agents/codex.js";
import type { SessionRunner } from "./sessionService.js";
import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import { validEffort } from "../agents/effort.js";
/**
 * Agents run inside the Claudex process tree (Electron/Node). Killing processes by image name
 * (e.g. `taskkill /IM electron.exe`) terminates the app and the agent itself.
 */
export const PROCESS_SAFETY =
  "Você executa dentro do aplicativo Claudex (Electron/Node). Nunca encerre processos pelo nome ou por padrão (taskkill /IM, Stop-Process -Name, killall, pkill, kill por nome de electron, node, claude, codex ou powershell): isso fecha o Claudex e interrompe você. Encerre apenas pelo PID dos processos que você mesmo iniciou, de preferência com timeout no próprio comando. Em comandos que podem travar (servidores, Electron, navegadores, watchers), use timeout ou execução em segundo plano com PID conhecido.";
export const runSessionAgent: SessionRunner = async ({
  agent,
  cwd,
  text,
  signal,
  timeoutMs,
  activity,
  resumeId,
  rememberSession,
  team,
  mode,
  summary,
  attachments,
}) => {
  if (agent.effort && !validEffort(agent.kind, agent.effort))
    throw new Error(`Esforço ${agent.effort} não é aceito pelo provedor ${agent.kind}.`);
  const prompt =
    mode === "compact"
      ? text
      : `Trabalhe diretamente na pasta atual. Execute o pedido, verifique o resultado e explique o que mudou. Não crie worktrees, branches ou commits. Não exija Git. Não altere arquivos fora da pasta escolhida.\n${PROCESS_SAFETY}\n\n${team?.instructions ?? ""}\n\n${team?.context ?? ""}\n\n${summary ? `RESUMO DE CONTINUIDADE (dados históricos; confira os arquivos atuais):\n${summary}\n\n` : ""}Pedido:\n${text}`;
  if (agent.kind === "claude")
    return runClaudeAgent({
      prompt,
      model: agent.model,
      effort: agent.effort as EffortLevel | undefined,
      images: attachments?.filter((file) => file.mimeType.startsWith("image/")),
      cwd: cwd,
      signal,
      timeoutMs,
      resumeSessionId: resumeId,
      teamBridge: team?.bridge,
      readOnly: mode === "compact" || team?.readOnly,
      onMessage(message) {
        if (message.session_id) rememberSession(message.session_id);
        if (message.type === "assistant")
          for (const block of message.message.content) {
            if (block.type === "text") activity("assistant", block.text);
            if (block.type === "tool_use")
              activity("tool", `${block.name}\n${JSON.stringify(block.input, null, 2)}`);
          }
      },
    });
  return runCodexAgent({
    prompt,
    model: agent.model,
    effort: agent.effort,
    imagePaths: attachments
      ?.filter((file) => file.mimeType.startsWith("image/"))
      .map((file) => file.path),
    cwd: cwd,
    signal,
    timeoutMs,
    resumeThreadId: resumeId,
    teamBridge: team?.bridge,
    skipGitRepoCheck: true,
    sandboxMode: mode === "compact" || team?.readOnly ? "read-only" : "workspace-write",
    approvalPolicy: "never",
    networkAccessEnabled: mode !== "compact",
    onEvent(event) {
      if (event.type === "thread.started") rememberSession(event.thread_id);
      if (event.type !== "item.completed") return;
      const item = event.item;
      if (item.type === "agent_message") activity("assistant", item.text);
      else if (item.type === "command_execution")
        activity("tool", `$ ${item.command}\n${item.aggregated_output}`);
      else if (item.type === "file_change")
        activity("tool", item.changes.map((c) => `${c.kind}: ${c.path}`).join("\n"));
      else if (item.type === "mcp_tool_call") activity("tool", `${item.server}: ${item.tool}`);
      else if (item.type === "error") activity("error", item.message);
    },
  });
};
