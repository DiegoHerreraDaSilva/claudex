# Experiência acessível: assistentes, tarefas e agendamentos

Pedido: implementar as três telas restantes, suavizar os temas e facilitar o uso por pessoas não técnicas.

| Módulo             | Responsabilidade                                                                             | Dependência                                     |
| ------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| work-items         | Criar, editar, executar, parar e acompanhar pedidos persistidos                              | ProjectRegistry, ChatService e resumo da missão |
| local-schedules    | Criar/editar, pausar/retomar/excluir e executar pedidos uma vez, diariamente ou semanalmente | work-items                                      |
| assistant-overview | Mostrar contas conectadas, papéis e atividade real, com acesso às configurações              | Credenciais e resumos de missão                 |
| accessible-ui      | Telas, onboarding, linguagem simples, temas suaves e detalhes técnicos recolhidos            | APIs dos módulos anteriores                     |

Ordem: tarefas → agendamentos → assistentes e interface → testes integrados e revisão.

## Contratos e comportamento

- Dados locais em um arquivo JSON versionado independente de projects.json, com validação e gravação atômica serializada. Não alterar o esquema do registro de projetos.
- Tarefas são pedidos humanos associados a uma conversa/missão. Etapas geradas pelo planejador continuam visíveis na missão, sem inventar estado individual quando ele não existe.
- CRUD de tarefas, execução explícita e interrupção. Cada tentativa cria conversa própria; repetir nunca aplica alterações automaticamente. Modo inicial assistido para novos pedidos; o usuário pode escolher análise ou autonomia.
- Agendamentos criam tarefas reais; uma vez, diariamente ou semanalmente. Executam apenas enquanto o servidor local está ativo. Ao reabrir, executar no máximo uma ocorrência vencida, sem acumular todas as ocorrências perdidas.
- Repetição acompanha o horário local do servidor. Fuso visível; mudança de fuso exige revisar o agendamento.
- Não sobrepor tarefas agendadas no mesmo projeto; esperar enquanto ele estiver ocupado. Registrar a ocorrência antes de lançar a missão; não repetir automaticamente uma execução interrompida por reinício.
- Agendar não implica aplicar, publicar ou fazer merge. Permissões da missão continuam passando pelo broker. Cada execução deixa histórico e ligação à missão.
- Assistentes usam Claude/Codex/Jev existentes; mostrar estado das contas, trabalhos recentes e configurar contas/modelo pelos controles reais já existentes.
- API HTTP local protegida por host/origem, validação Zod, limite de corpo e operações sobre projetos registrados.

## Interface

- Navegação em PT: Assistentes, Tarefas, Agendamentos. Inglês equivalente.
- Grafite em vez de preto no escuro; superfícies cinza suaves em vez de branco no claro. Contraste legível, foco visível, botões maiores e largura responsiva.
- Explicar o primeiro passo quando não há projeto/conta. Projetos, pedidos, revisão e aplicação em linguagem comum.
- Informações sobre branches, tokens, terminal e logs em detalhes técnicos; ferramentas continuam acessíveis.
- Remover atalhos falsos de “Em breve”: conectar às funcionalidades existentes ou a uma ação útil.
- Frases começam com maiúscula; não alterar código, nomes de arquivo ou textos do usuário.

## Aceite e validação

- Criar/editar/excluir tarefa, executar em missão nova, parar e abrir resultado; listas globais com busca, projeto e situação.
- Criar/editar agendamento, persistir, pausar/retomar/excluir, execução real com serviços de missão, histórico e prevenção de duplicação/sobreposição.
- Todas as três telas funcionais, sem placeholder.
- Testes Vitest de dados, concorrência, recorrência, reinício e API; SDKs pagos simulados.
- Build, lint, suíte completa e smoke real da interface em PT/EN, temas claro/escuro e 320/768/1440px. Capturas verificadas visualmente.
- Publicar na PR de desenvolvimento existente após revisão; sem release ou merge.

## Implementação e evidências

As três telas foram conectadas a WorkService, AutomationStore e às rotas HTTP locais. A execução reaproveita ChatService e o fluxo existente de missão, revisão e permissões. Conversas geradas recebem um identificador de tarefa opcional, sem mudar a versão do registro.

A suíte completa passou com 99 testes em 24 arquivos, incluindo os novos testes de serviço e quatro testes HTTP. Build e lint passaram. O smoke anterior de QA no navegador e PR/CI também passou. O smoke `scripts/experience-ui-check.mjs` usa armazenamento e rotas reais, simulando apenas os assistentes. Conferiu salvar pedido, erro de conta ausente sem perda de dados, execução assistida até revisão, pausa de agenda, estado das contas, PT/EN, temas e navegação em 320/390/768/1440px. Capturas ficam na pasta ignorada `.claudex/qa/experience`.

Limites: agendador local com intervalo de 15 segundos; 1.000 tarefas e 100 agendas. A pasta adicionada ainda precisa ser um projeto Git. Nenhuma execução paga foi feita para validar as telas.
