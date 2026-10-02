# Colaboração automática sem Git

Contrato autorizado pelo pedido: corrigir duplicação, compartilhar mudanças entre modelos, permitir delegação e simultaneidade automáticas e configurar modelos por agente.

Esforço por papel: `DEFAULT_SIMPLE_EFFORT`, `DEFAULT_COMPLEX_EFFORT` e `DEFAULT_PLANNER_EFFORT` persistem nos ajustes. Vazio omite esforço no SDK; valores explícitos são validados por provedor e enviados como `effort` ao Claude ou `modelReasoningEffort` ao Codex. As delegações usam o esforço do papel escolhido para a subtarefa. A chave de reutilização não inclui esforço; mudar só o esforço retoma a mesma conversa. Sessões guardam o esforço da última chamada, também usado na compactação. Execuções já ativas não são reconfiguradas. O suporte final depende do modelo selecionado.

| Módulo         | Responsabilidade                                                                                      | Dependência                          |
| -------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------ |
| activity       | Mostrar uma resposta final sem repetir a mensagem do SDK                                              | —                                    |
| project-memory | Registro persistente de pedidos, resultados e arquivos alterados, detectando também mudanças externas | —                                    |
| agent-team     | Comunicação, reservas de caminhos, subagentes, cancelamento e limites                                 | project-memory                       |
| model-settings | Escolha de provedor/modelo por papel de agente                                                        | —                                    |
| team-interface | Abas de colaboradores, progresso e configurações em linguagem simples                                 | agent-team, model-settings, activity |

Implementação em incrementos nessa ordem. TypeScript strict, Zod nas fronteiras e SDK MCP oficial para ferramentas comuns aos dois provedores. Os SDKs instalados confirmam resume e configuração MCP.

Cada projeto preserva suas sessões principais por modelo e sessões auxiliares por modelo/área. Toda chamada recebe memória recente compartilhada e precisa consultar arquivos atuais. Ferramentas read_team, message_team, delegate e wait_agents permitem colaboração em tempo real. delegate retorna imediatamente; wait_agents reúne resultados, permitindo iniciar vários auxiliares antes de esperar. Jev seleciona o modelo usando o pedido e a memória. Modelos configuráveis nos papéis mudanças simples, implementação e arquitetura; auxiliares também usam essas escolhas.

Uma equipe por pasta (inclusive pastas sobrepostas), até quatro agentes ativos, oito delegações por pedido e dois níveis. Reservas recusam caminhos sobrepostos entre auxiliares; leitura compartilhada permitida. O coordenador não edita áreas delegadas enquanto estão reservadas. Reservas são coordenação cooperativa, não isolamento de filesystem; alterações detectadas fora do escopo são reportadas como falha, sem rollback. Parar qualquer membro cancela a equipe. Ao fechar, todos encerram. Falhas dos auxiliares são comunicadas ao coordenador; não produzir sucesso silencioso. Nenhum Git, worktree ou fila/agendamento do produto.

Memória e inventário ficam nos dados do app, não na pasta do usuário. Inventário ignora dependências, artefatos e diretórios internos, não segue links simbólicos e informa varreduras incompletas. Não lê conteúdos para o prompt: hashes e caminhos detectam mudanças. Memória contém resumos fornecidos pelos agentes, como dados e não instruções.

Verificação: npm run typecheck; npm run lint; npm test -- --maxWorkers=2 --minWorkers=1; npm run build; npm run ui:check. Testes reproduzem duplicação, troca de modelos com memória, alterações externas, paralelismo, comunicação, delegação recursiva, conflitos, limite/cancelamento e MCP real com runner simulado. Chrome verifica resposta única, abas, modelos e colaboração. Sem chamadas pagas na validação. Não criar release ou publicar no GitHub neste pedido.

Fontes dos contratos SDK: [Claude Agent SDK MCP](https://code.claude.com/docs/en/agent-sdk/mcp), [Codex TypeScript SDK](https://github.com/openai/codex/tree/main/sdk/typescript), [MCP server](https://modelcontextprotocol.io/docs/develop/build-server). Conferidos com as declaracoes das versoes instaladas e com um cliente MCP real em stdio.
