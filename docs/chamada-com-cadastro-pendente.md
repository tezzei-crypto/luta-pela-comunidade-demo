# Chamada de crianças com dados pendentes

A turma ativa pode conter matrículas aprovadas e vínculos provisórios. Os vínculos provisórios usam o protocolo da ficha original: não criam alunos fictícios nem registram consentimentos ou conferência documental.

Ao abrir uma aula, o sistema guarda a lista prevista naquele momento. O professor vinculado, a administração e a secretaria geral podem registrar Presente, Faltou, Justificada ou Limpar. Secretaria local apenas consulta. Nome, situação da ficha, versão, conta responsável e horário são preservados; o professor não recebe contatos do responsável ou documentos por esse fluxo.

As marcações provisórias entram no resumo da chamada, na contagem de preenchimento das chamadas pendentes, na conferência administrativa, no histórico e na exportação CSV. O CSV diferencia `registration` de `student` na coluna `record_type`. A contagem de atividades inclui essas presenças como participantes ainda sem matrícula aprovada. Alertas individuais e progressão de matrículas aprovadas continuam sendo fluxos próprios; não se presume contato da família ou aprovação documental.

A aprovação posterior gera a matrícula no mesmo grupo, preservando a lista e as marcações das aulas anteriores. Aulas já abertas não são alteradas automaticamente quando a lista da turma muda. Não se acrescentam presenças reais para testar.

Validação: listas sintéticas de 15 e 19 crianças; acesso de professor restrito a um núcleo; leitura e salvamento; recarga; autoria e paginação de histórico misto; bloqueios de outro professor, outra turma, outro núcleo, responsável, secretaria local, data futura, aula cancelada e versão antiga; preservação após aprovação e reabertura do armazenamento. Fluxo também exercitado no navegador com SQLite e perfil de professor fictício, em computador e largura de celular.

As consultas automáticas de revisão e avisos têm cota limitada separada das operações de trabalho. Login permanece limitado a 20 tentativas por 10 minutos por endereço; as cotas de dados e atualização automática têm 300 requisições por 10 minutos, separadas. Autenticação, escopo por núcleo e limites de gravação permanecem obrigatórios.
