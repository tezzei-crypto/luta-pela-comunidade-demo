# Roteiro de execução e melhoria por núcleo

Atue como responsável por engenharia e qualidade do Luta pela Comunidade. Execute a revisão até produzir mudanças verificadas e um relatório, respeitando AGENTS.md e preservando dados existentes.

## Objetivo
Organizar o trabalho por Amavale, Valparaíso e Vale do Carangola. Reduzir a necessidade de repetir filtros e tornar visíveis horários, situação das turmas e cadastros incompletos. Use nomes e estados compreensíveis, sem alterar regras de acesso ou inventar informações.

## Método
1. Levante rotas públicas e módulos administrativos, permissões por função, persistência, arquivos privados e integrações. Confira primeiro o que já existe para evitar duplicação.
2. Consulte documentação primária de sistemas universitários, como Canvas, e padrões W3C/WAI. Distinga princípios de usabilidade, padrões técnicos e decisões administrativas; não atribua eficácia científica local sem medição com usuários.
3. Percorra as telas no computador e no celular. Verifique carregamento, rótulos, teclado, estados vazios, erros, navegação, imagens e largura. Registre dimensões e resultados sem copiar dados pessoais para o relatório.
4. Teste, em dados sintéticos e armazenamento isolado, autenticação, perfis e núcleos, alunos e importação, responsáveis e documentos, turmas e matrículas, presença, equipe, atendimentos, avisos, exportação, auditoria, sincronização e recuperação de backup. Inclua sucesso, validação, repetição, concorrência, falha e acesso negado nos fluxos pertinentes.
5. Faça melhorias proporcionais a problemas observados. Mantenha o contexto de núcleo entre listas compatíveis; identifique explicitamente os módulos globais e formulários com filtros próprios. Preserve o servidor como autoridade de acesso.
6. Não substitua cadastros incompletos por aprovações, não declare documentos conferidos sem evidência, não registre chamadas ou atendimentos fictícios em produção e não envie comunicações reais como teste.
7. Execute a suíte completa em Node.js 24 e testes de regressão das mudanças. Confira celular e computador com o sistema real em ambiente isolado antes de publicar.
8. Publique no serviço existente, confira o build, a revisão publicada, a saúde e os fluxos afetados. Nunca publique bancos, fotos de participantes, credenciais ou dados de teste.
9. Entregue mudanças, evidências, limitações e pendências. Não use percentuais sem critérios nem declare cobertura exaustiva ou certificação de acessibilidade.

## Critérios específicos do Vale do Carangola
- Reutilizar as duas turmas já cadastradas: segundas e quartas, manhã 10h30–11h30 e tarde 15h–16h, horário de Brasília.
- Manter as 15 crianças da manhã em um grupo de origem e as 19 da tarde em outro, com fotos e referências preservadas.
- Permitir à secretaria completar as fichas gradualmente; não duplicar registros.
- Nelson Erick Miguez é o professor indicado. A liberação e o vínculo operacional dependem do cadastro e da habilitação efetivamente conferidos.

## Referências consultadas
- Harvard GSE, Sections in Canvas: https://canvas.gse.harvard.edu/faq/how-do-i-use-sections-canvas
- W3C/WAI, Grouping Controls: https://www.w3.org/WAI/tutorials/forms/grouping/
- Nielsen Norman Group, Memory Recognition and Recall: https://www.nngroup.com/articles/recognition-and-recall/

Este roteiro foi aplicado na revisão de 22/10/2026. O relatório registra o escopo efetivamente verificado.
