# Revisão de 22/10/2026

## Resultado implementado
- Núcleo de trabalho no painel, limitado aos núcleos autorizados.
- Contexto compartilhado entre listas de alunos, candidatos, turmas, matrículas pendentes, conferências, relatório de presença, calendário de atendimentos e chamadas pendentes.
- Professores, monitores e profissionais filtrados pelo contexto de núcleo. Cadastros compartilhados continuam sujeitos às restrições já existentes no servidor.
- Módulos globais e formulários com filtros próprios são identificados; escolher um núcleo não equivale a restringir uma exportação ou mudar permissões.
- Consulta dos horários reais das turmas, com dias, horários de Brasília, situação ativa ou planejada, professores habilitados e quantidade de matriculados. Falhas apresentam nova tentativa; respostas antigas são descartadas.
- Nenhum aluno, turma, chamada, atendimento ou documento existente foi apagado. Nenhum aviso real foi enviado como teste.

## Configuração confirmada
Vale do Carangola tem duas turmas: segunda e quarta, 10h30–11h30 e 15h–16h. Ambas estão cadastradas e inativas, aguardando habilitação do professor. O email informado para Nelson foi complementado na ficha existente. Não foi declarada conferência documental nem liberado acesso de teste.
Os 34 pré-cadastros importados com fotos permanecem visíveis em Alunos, com situação incompleta e abertura da ficha para complementação pela secretaria. Aprovação e matrícula operacional permanecem etapas distintas.

## Evidências
- Navegação em 24 módulos administrativos no computador e em largura de 390 px; todos os módulos presentes e visíveis, sem transbordamento horizontal nas observações.
- Navegação em 11 rotas públicas no computador e no celular; nenhum transbordamento horizontal ou imagem quebrada nas observações. Formulários reais não foram enviados como teste.
- Ambiente local real com SQLite e dados fictícios: login com transporte de email simulado, seleção do núcleo, navegação Alunos/Turmas, troca de núcleo e consulta de horários planejados; conferido em computador e celular.
- Suíte completa Node.js 24: 441 testes, 440 aprovados, nenhum reprovado e 1 teste ignorado no Windows. O resultado Linux da publicação deve ser confirmado separadamente.
- Testes novos: continuidade e alteração de contexto, escopo da secretaria, ausência do seletor para responsáveis, horários, erro com tentativa novamente e descarte de resposta antiga.
- A suíte existente cobre os principais fluxos públicos e administrativos, permissões entre núcleos, persistência, conflitos, avisos e restauração sintética. Quantidade de testes não representa cobertura exaustiva de todas as combinações.

## Limitações e próximos passos operacionais
- O sistema ainda sinaliza pendência do teste de recuperação do backup real. A recuperação sintética foi testada; não foi restaurado o banco de produção.
- Turmas inativas não abrem chamadas. A habilitação de Nelson exige complementar e conferir os documentos e informações do professor; os alunos precisam concluir as fichas para matrícula aprovada.
- Entrega real de email/WhatsApp e uso por cada perfil não foram integralmente repetidos em produção nesta revisão. Integração WhatsApp continua dependente das configurações reais anteriormente pendentes.
- Leitor de tela, todos os dispositivos físicos, todas as combinações de autorização e testes de carga não são comprovados por esta revisão.
- Validar a melhoria com a secretaria: medir tempo para localizar uma criança, localizar seu horário e completar um responsável, além de erros de núcleo, antes e depois. As referências orientam a solução; não provam eficácia nesta população.

## Fundamentação
A organização em seções e os filtros usam como referência a documentação do Canvas em Harvard; isso é referência operacional, não ranking de universidades. Rótulos e grupos seguem orientação W3C/WAI. Contexto visível e opções reconhecíveis são orientados por heurísticas de usabilidade descritas por Nielsen Norman Group. Horários, regras de autorização e exigências documentais são decisões do projeto, não conclusões científicas.

Fontes e roteiro: [Prompt aplicado](prompt-auditoria-por-nucleo.md).
