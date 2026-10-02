import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { toolInputs } from "../application/agentTeam.js";

const descriptions: Record<string, string> = {
  read_team:
    "Leia memória compartilhada, mensagens, resultados e áreas reservadas da equipe. Consulte antes de editar.",

  message_team:
    "Envie decisões, contratos ou mudanças a outro agente ou à equipe. Mensagens ficam disponíveis em read_team.",

  delegate:
    "Inicie um colaborador automaticamente. Jev escolhe o modelo. Informe paths exclusivos de edição ou readOnly para análise. Retorna imediatamente para permitir delegações em paralelo.",

  wait_agents:
    "Aguarde seus colaboradores e leia seus resultados. Se algum ainda estiver running, chame novamente antes de dar a resposta final.",
};

const endpoint = process.env["CLAUDEX_TEAM_ENDPOINT"] ?? "";

if (!/^http:\/\/127\.0\.0\.1:\d+\/tools$/.test(endpoint)) throw new Error("Equipe indisponível");

const server = new McpServer({ name: "claudex-team", version: "1.0.0" });

for (const [name, schema] of Object.entries(toolInputs)) {
  server.registerTool(
    name,

    { description: descriptions[name], inputSchema: schema },

    async (input: unknown) => {
      try {
        const response = await fetch(endpoint, {
          method: "POST",

          headers: {
            "Content-Type": "application/json",

            Authorization: `Bearer ${process.env["CLAUDEX_TEAM_TOKEN"]}`,
          },

          body: JSON.stringify({ member: process.env["CLAUDEX_TEAM_MEMBER"], name, input }),
        });

        const data = (await response.json()) as { value?: unknown; error?: string };

        return {
          isError: !response.ok,

          content: [
            {
              type: "text" as const,

              text: JSON.stringify(data.error ? { error: data.error } : data.value),
            },
          ],
        };
      } catch {
        return {
          isError: true,

          content: [{ type: "text" as const, text: "Comunicação com a equipe interrompida." }],
        };
      }
    },
  );
}

await server.connect(new StdioServerTransport());
