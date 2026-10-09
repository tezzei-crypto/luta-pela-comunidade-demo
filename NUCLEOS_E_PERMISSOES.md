# Administração por núcleo — Luta pela Comunidade

## Brief de execução e critérios de aceitação

Implementar no projeto existente uma autorização baseada na função da pessoa e
nos núcleos atribuídos à sua conta. Preservar o administrador geral, os registros
reais e os fluxos de professores, responsáveis e profissionais. Não conceder
acessos, aprovar pessoas ou enviar mensagens reais durante os testes.

Cada secretaria deve ter pelo menos um núcleo escolhido pelo administrador geral.
A seleção pode incluir Amavale, Valparaíso e Vale do Carangola. Revalidar o escopo
no servidor em cada operação, inclusive acesso direto por ID, arquivos, lotes,
exportações e rotinas de notificação. Métodos novos sem classificação devem ser
recusados. O navegador apresenta as opções autorizadas, mas não decide permissões.

Testar leitura, gravação, tentativa de acesso cruzado, concorrência de versão,
revogação, reinício, conta sem núcleo, conta com múltiplos núcleos, arquivo privado,
CSV misto, agenda presencial/online e atendimento de aluno oriundo de outro núcleo.
Reexecutar a suíte completa e as regressões da agenda antes da publicação.

## Matriz adotada

| Recurso | Administrador geral | Secretaria |
|---|---|---|
| Alunos, candidatos, contatos, documentos, faixa e graus | Todos | Núcleos atribuídos |
| Turmas, chamada de alunos/equipe, ocorrências, relatórios, CSV | Todos | Núcleos atribuídos |
| Professores, profissionais e monitores exclusivos | Todos | Cadastro integral somente se todos os vínculos estiverem no seu escopo |
| Funcionários compartilhados com outros núcleos | Gestão integral | Identificação operacional mínima; cadastro centralizado |
| Agenda, preferências, confirmação e remarcação | Todos | Núcleo do atendimento, inclusive online |
| Contas, vínculos manuais, permissões e desligamento global | Gestão integral | Administração geral |
| Editor público, contato global, regras de graduação/lembretes, auditoria geral | Gestão integral | Administração geral |
| Alertas de faltas e chamada pendente | Todos | Somente núcleos atribuídos; fila revalidada antes do envio |

A secretaria que recebe um atendimento de aluno de outro núcleo pode acompanhar
essa solicitação e seu contato administrativo. Isso não concede acesso à ficha,
documentação ou histórico completo do aluno. Remarcações para núcleo fora do escopo
exigem a administração geral. A modalidade online mantém um núcleo responsável.

## Implementação

`administrative_units` persiste os vínculos. `unit-scope.mjs` define a política e
uma fachada por usuário usada por todos os handlers autenticados. Operações não
classificadas são negadas para secretarias. Consultas limitadas e paginadas de
inscrições, agenda, solicitações e vagas aplicam o filtro no SQL antes do limite.
O ator autenticado não pode ser substituído pelo parâmetro de outra conta.

Atribuir ou remover núcleos usa controle de versão, preserva histórico e encerra
sessões e códigos existentes. Alterações de função/ativação também são verificadas
durante a requisição. O último administrador ativo e a própria conta continuam
protegidos. Aprovar um candidato local mantém a criação automática do vínculo do
responsável, sem conceder à secretaria gestão global de contas.

## Migração e publicação

Não há atribuição automática de núcleos a secretarias antigas. Antes de publicar,
levantar as contas reais, obter da gestão seus núcleos e preparar a atribuição.
Uma conta sem núcleo não acessa registros locais. Administradores continuam globais.
Esta regra é intencional: não inferir o núcleo pelo email, nome ou último acesso.

A preparação desta alteração identificou uma conta de secretaria já existente.
A publicação deve aguardar a definição do seu escopo, para evitar interromper a
operação. Não migrar dados de teste para produção. A base SQLite e os documentos
persistentes permanecem no Render.

## Evidência e limites

Fundamento técnico: [NIST SP 800-162 — controle por atributos](https://csrc.nist.gov/pubs/sp/800/162/upd2/final)
e [OWASP — autorização](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).
Função, núcleo do recurso e núcleos da conta são os atributos usados. Negação por
padrão e verificação no servidor seguem esses guias; são padrões de engenharia,
não uma alegação de eficácia clínica ou certificação científica.

Referência de organização de portais: [HighLevel — funções e dados atribuídos por subconta](https://help.gohighlevel.com/support/solutions/articles/155000002544).
A adaptação mantém uma base comum e escopo por núcleo; não duplica o site nem
introduz subcontas externas. Não houve consulta a especialistas humanos.

Os testes automatizados usam dados fictícios e armazenamento isolado. JSDOM
verifica comportamento do formulário e da agenda, mas não substitui a conferência
visual em navegadores reais. Suíte aprovada não significa ausência de defeitos.
