import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AgentTeam } from "../dist/application/agentTeam.js";

const folder = await mkdtemp(path.join(tmpdir(), "claudex-mcp-"));
const client = new Client({ name: "claudex-qa", version: "1.0.0" });
const controller = new AbortController();
const agent = { kind: "claude", model: "sonnet", label: "claude:sonnet" };
const team = new AgentTeam({
  folder,
  controller,
  root: { id: "main", agent, task: "coordenação", depth: 0, scopes: [], readOnly: false },
  route: async () => agent,
  create: () => randomUUID(),
  memory: () => "Contrato anterior compartilhado",
  activity: () => {},
  finish: async () => {},
  run: async (member, tools) => {
    if (member.id !== "main") {
      assert.match(JSON.stringify(await tools.call("read_team", {})), /Contrato anterior/);
      await tools.call("message_team", { text: "Análise concluída", to: "main" });
      return "Resultado do colaborador";
    }
    const transport = new StdioClientTransport({
      ...tools.bridge,
      env: { ...process.env, ...tools.bridge.env },
    });
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((t) => t.name).sort(), [
      "delegate",
      "message_team",
      "read_team",
      "wait_agents",
    ]);
    const blocked = await fetch(tools.bridge.env.CLAUDEX_TEAM_ENDPOINT, {
      method: "POST",
      body: "{}",
    });
    assert.equal(blocked.status, 403);
    const spawned = await client.callTool({
      name: "delegate",
      arguments: { text: "analise sem editar", readOnly: true },
    });
    assert.equal(spawned.isError, false);
    const { id } = JSON.parse(spawned.content[0].text);
    const joined = await client.callTool({ name: "wait_agents", arguments: { ids: [id] } });
    assert.match(JSON.stringify(joined), /Resultado do colaborador/);
    const board = await client.callTool({ name: "read_team", arguments: {} });
    assert.match(JSON.stringify(board), /Análise concluída/);
    const invalid = await client.callTool({
      name: "delegate",
      arguments: { text: "escape", paths: ["../outside"] },
    });
    assert.equal(invalid.isError, true);
    await client.close();
    return "Coordenação concluída";
  },
});
try {
  await team.run();
  console.log(
    "MCP passed: stdio tools, delegation, messages, results, authentication and path validation.",
  );
} finally {
  controller.abort();
  await client.close();
  await team.close();
  await rm(folder, { recursive: true, force: true });
}
