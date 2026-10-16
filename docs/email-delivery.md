# Entrega dos avisos automáticos

Os avisos usam filas persistentes no SQLite. Uma resposta HTTP 429 do Resend indica recusa por limite, não entrega. O aviso permanece pendente, sem consumir as tentativas reservadas a respostas incertas. O bloqueio é compartilhado pelos módulos, persistido no disco e respeitado após reinício. Não são guardados segredos nem respostas privadas do provedor nessa tabela.

O limite diário retoma após a meia-noite UTC (21h de Brasília), ou no prazo informado em `Retry-After`. No limite mensal sem prazo informado, o sistema consulta novamente ao tentar enviar após uma hora: não presume a data de renovação do plano. O agendador existente verifica as filas a cada cinco minutos. A cota também é compartilhada com os códigos de login; a correção não amplia o plano contratado.

Alertas novos de faltas são agrupados por destinatário e dia de Brasília. Novos casos posteriores ao resumo continuam disponíveis imediatamente no painel e entram no próximo resumo. Tentativas antigas conservam sua chave e conteúdo. Respostas incertas com mais de 23 horas exigem conferência; não são reenviadas como mensagens novas. A autoria, as presenças, o início oficial e as preferências individuais de email permanecem nas regras existentes.

Secretarias recebem apenas tarefas dos núcleos autorizados. O painel de documentos, matrículas e conferências indica quando o provedor está pausado. Aceito pelo provedor não significa entregue ou lido. A confirmação de entrega exige consultar o evento do provedor.

Resumos diários definitivamente não enviados e já vencidos são substituídos pelo resumo atual. Pré-cadastros novos permanecem na fila até o envio ou até deixarem de ser pertinentes. Antes de tentar enviar, os módulos verificam se a pessoa ainda tem acesso e se a pendência permanece. Conteúdo potencialmente já aceito não é alterado durante uma repetição.

Validação: testes isolados de cota diária, mensal e de velocidade; reinício; concorrência; recuperação; chave idempotente; revogação e escopo; limite de tentativas incertas; agrupamento de faltas; preservação da matrícula e da reserva; interface com viewport móvel. Nenhum email real é necessário para esses testes. O evento real após a renovação da cota deve ser conferido no provedor.

Fundamentação de engenharia: [erros oficiais do Resend](https://resend.com/docs/api-reference/errors), [idempotência](https://resend.com/blog/engineering-idempotency-keys) e [limites dos planos](https://resend.com/pricing). São práticas de confiabilidade de software, não uma certificação científica de ausência de falhas.
