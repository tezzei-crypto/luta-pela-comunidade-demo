# Luta pela Comunidade

Site público e portal privado em HTML, CSS e JavaScript, com Node.js 24 e SQLite. O código público não contém dados de alunos, documentos ou credenciais.

## Execução e verificação

- Build: npm install --ignore-scripts --no-audit --no-fund && npm test
- Start: node server.mjs
- Health check: /api/health
- Administração: /administracao/
- Ficha do aluno/responsável: /portal/

## Editor do site

Administradores gerais acessam `/administracao/#site-editor-area`. O editor oferece textos, imagens, links, títulos e descrições das nove páginas públicas catalogadas, além das perguntas, opções e mensagens do contato pelo WhatsApp. Campos dinâmicos de validação, documentos privados e regras operacionais continuam nos respectivos módulos. Cada página mantém seu próprio rascunho; salvar não publica. Confira a prévia, descreva a alteração e publique. O histórico recupera a versão anterior como rascunho, exigindo nova publicação. Versões concorrentes retornam conflito, sem sobrescrever outra edição.

Imagens autorizadas para divulgação são reprocessadas em WebP sem metadados e armazenadas separadamente dos documentos privados. A biblioteca aceita JPG, PNG e WebP estáticos de até 8 MB e 40 milhões de pixels. Alterar código ou estrutura de uma página pode invalidar seu rascunho anterior; o editor exige reabertura e conferência. Templates públicos são renderizados no servidor para que as edições apareçam antes da execução do JavaScript. Testes utilizam somente dados fictícios.

## Armazenamento privado no Render

Requer serviço pago com disco persistente montado em /var/data. Configure PORTAL_DATA_DIR=/var/data/luta, PERSISTENT_STORAGE_CONFIRMED=true, PORTAL_SECRET com pelo menos 32 caracteres aleatórios, BOOTSTRAP_ADMIN_EMAIL e PUBLIC_ORIGIN. Configure RESEND_API_KEY e MAIL_FROM para os códigos de acesso e notificações. Nunca grave os valores secretos no repositório.

O administrador inicial entra por código de uso único enviado ao email configurado. Responsáveis só acessam alunos vinculados pela equipe. Professores, psicologia e assistência social têm menus e APIs limitados à sua função e aos núcleos conferidos. IDs públicos não autenticam uma pessoa nem expõem nomes e documentos.

Importe o CSV inicial no portal ou com node portal-maintenance.mjs import /caminho/privado/alunos.csv. Preserve os IDs existentes. Ative PORTAL_REGISTRY_ACTIVE=true somente depois da conferência da importação. PORTAL_INTAKE_ACTIVE=true grava novas inscrições e arquivos no disco privado. METRICS_ENABLED=true oferece estatísticas opcionais nas páginas públicas, com consentimento.

## Backup e limites

Administradores gerais acessam **Backup e recuperação** no painel. O pacote completo criptografado reúne snapshot consistente do SQLite, documentos referenciados, fotos, código e configuração. A chave privada fica fora do servidor. O painel distingue geração, envio ao Drive e relatório de restauração; somente a administração geral tem acesso. Consulte [o procedimento completo](BACKUP_RECUPERACAO.md) e [o prompt de implementação](PROMPT_BACKUP_PROFISSIONAL.txt).

A automação do Google Drive exige OAuth institucional configurado no servidor. Downloads para computador e cópias em HD são operações separadas. A restauração pela ferramenta técnica recusa diretórios existentes. O comando legado de manutenção cria somente cópia do banco. Não envie bancos, documentos, backups ou segredos ao GitHub.

## Professores e ocorrências

Área `/professor/`, cadastro e conferência pela administração. Professores atuam somente nos núcleos autorizados, com chamada e relatos privados. A habilitação requer foto e diploma conferidos. Cada novo documento retorna a situação para conferência. Relatos originais são preservados; complementos, encerramento e reabertura geram histórico. CSV administrativo dos relatos inclui `updates_json`.


## Turmas, profissionais e agenda

O menu autenticado separa Alunos, Candidatos, Professores, Psicologia e assistência social, Agenda, Turmas e matrículas, Presença e Relatos. A chamada usa botões por aluno e gravação em lote. A lista é capturada ao abrir a aula; uma edição posterior da turma preserva chamadas anteriores.

BOOTSTRAP_AMAVALE_GROUPS=true, junto do arquivo privado inicial, cadastra uma única vez as turmas autorizadas de terça/quinta: 11–17 anos às 15:00–16:00 e 5–10 anos às 16:25–17:00. Matrículas iniciais consideram a idade na data da implantação e somente os IDs da importação aprovada. Não altera matrícula em reinícios. Aniversários e novas aprovações exigem conferência da matrícula pela administração.

Profissionais entram por código no email. O cadastro, RG/CPF e documentos são gerenciados pela administração geral ou por secretaria autorizada para todos os núcleos do profissional. Cadastros compartilhados com núcleos fora do escopo têm gestão centralizada. A liberação exige conferência humana, foto, conselho atualizado e prazo de nova conferência. Novos documentos suspendem a oferta de horários até reconferência. Não há consulta automática aos conselhos.

Horários são explícitos, em Brasília, por núcleo. Reserva com transação SQLite, prevenção de sobreposição do profissional/aluno, idempotência e controle de versão. A secretaria confirma por WhatsApp e registra a confirmação. O sistema não envia WhatsApp automaticamente. Solicitações persistem mesmo com falha no aviso por email.

Os formulários Ocorrência e Lesão usam os campos do modelo Relatorios_Jiu_Jitsu_FJJE_Rio, sem exigir upload do XLS e sem transformar relato em diagnóstico. O autor e horário são registrados; complementos preservam o original.

## Equipe, permissões e frequência

- `/administracao/#team-area`: Equipe e acessos, com cadastro de secretaria e administradores por nome completo, email e telefone. Somente administradores gerais gerenciam contas de outros administradores. Somente a administração geral concede funções e núcleos às secretarias. Ninguém desativa a própria conta ou altera a própria função. Sessões e códigos são revogados quando o acesso muda; versões evitam perda de edições simultâneas.
- Administradores gerenciam todo o projeto. Secretarias gerenciam alunos, candidatos, documentos, equipe, turmas, agenda e planilhas apenas nos núcleos atribuídos. O histórico geral, as contas e as configurações globais ficam com a administração geral. Uma inscrição completa continua pendente até aprovação explícita; só então recebe ID.
- Professor tem presença dos alunos e relatos de ocorrência/lesão nos núcleos autorizados. Consulta os próprios relatos; não acessa fichas privadas, cadastros, agenda ou chamada da equipe.
- Psicologia e assistência social têm relatos dos núcleos autorizados e somente a própria agenda e solicitações. Não têm acesso ao cadastro privado dos alunos nem a agendas de outros profissionais.
- Monitores têm cadastro administrativo com núcleos de atuação, sem criar login automaticamente. Frequência da equipe é lançada pela secretaria ou administração: selecionar turma, data e integrantes previstos, marcar e salvar em lote. Ausência de marcação não vira falta. Lista histórica, correções, autor, versão e CSV são preservados.

O menu mobile recolhe após a escolha; botões de chamada têm pelo menos 48 px, campos usam fonte de 16 px e há confirmação do salvamento. Testes de largura não equivalem a certificação em aparelhos físicos. Fundamentação: autorização em cada requisição e menor privilégio (OWASP Authorization Cheat Sheet), tamanho de alvos e ampliação/refluxo (WCAG 2.2). A suíte automatizada usa somente dados fictícios e diretórios temporários.

Consulte [Núcleos e permissões](NUCLEOS_E_PERMISSOES.md) para a matriz de autorização, a migração das contas existentes e os critérios de teste.
