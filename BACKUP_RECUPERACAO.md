# Backup e recuperação — Luta pela Comunidade

Esta política reduz riscos; nenhuma configuração elimina todas as possibilidades de perda. Criar um arquivo, manter uma cópia externa e demonstrar recuperação são três verificações distintas. O painel informa cada uma separadamente.

## Arquitetura e responsabilidades

- Servidor Render: gera pacote criptografado completo, com frequência configurável de 4, 12 ou 24 horas. Recomendação inicial: 4 horas, com tolerância operacional de cinco minutos do agendador. É meta de RPO, condicionada a execuções e transferências bem-sucedidas, não garantia de perda máxima.
- Google Drive institucional: destino externo para arquivos `.lpcb`, em pasta privada, com conta institucional e autenticação multifator. O envio automático exige autorização da API; uma pasta criada ou um upload manual não ativam a rotina automática.
- Computador da administração: guardar outra cópia criptografada e a ferramenta de recuperação. Downloads do painel são manuais nesta versão.
- HD externo: copiar periodicamente o pacote criptografado e desconectar após conferir o SHA-256. Alternar duas mídias e manter uma em outro local físico, quando possível. Sincronização permanente pode propagar exclusões ou ransomware; não substitui a cópia desconectada.
- Chave privada: guardar duas cópias sob custódia da administração, separadas dos arquivos de backup, preferencialmente em cofre de senhas/segredos e mídia protegida. A chave pública fica no servidor. A perda de todas as chaves privadas torna os respectivos backups irrecuperáveis. Ao trocar de chave, conservar as anteriores enquanto seus backups existirem.

## Conteúdo e integridade

O pacote contém snapshot consistente do SQLite, documentos referenciados pelo banco, fotos, mídias e conteúdo do editor, código da aplicação, lockfile das dependências e configuração operacional permitida. As contas, turmas, chamadas, agenda e histórico estão no banco. Tokens de serviços e o segredo do portal ficam somente dentro do conteúdo criptografado.

Não inclui sessões ativas, códigos de login, uploads órfãos sem referência, `node_modules`, contas externas, caixas de email, zona DNS ou conteúdo do Drive. A configuração guarda explicitamente as variáveis operacionais; caminhos do computador, variáveis de bootstrap de importação e parâmetros do provedor precisam ser revisados ao reimplantar. O `render.yaml` acompanha o código, mas configurações feitas apenas no painel do provedor devem ser documentadas separadamente.

SQLite usa a API nativa de backup, sem copiar simplesmente o arquivo de um banco em WAL. Cada arquivo recebe SHA-256 e a restauração confere manifesto, quantidades, integridade do banco, vínculos e documentos. Criptografia: chave aleatória AES-256-GCM por pacote, protegida por RSA-OAEP-SHA256 de pelo menos 3072 bits. A autenticação do pacote é conferida antes de extrair. Caminhos perigosos, links, duplicatas e excesso de tamanho são recusados. Isso não equivale a assinatura de autoria: quem possui a chave pública pode criar um pacote; conferir também a procedência e o SHA-256 registrado no sistema.

Limites desta versão: 2 GB descompactados e 30 mil entradas. O servidor verifica espaço para conteúdo temporário, pacote e uma reserva de 256 MB. Se faltar espaço ou algum documento, registra falha e preserva cópias anteriores. A geração não apaga backups antigos automaticamente.

## Operação

Usar Node.js 24 e as dependências do lockfile. Executar os comandos no diretório do código. Substituir exemplos por caminhos absolutos reais; nunca usar a pasta de produção como destino de restauração.

```powershell
node backup-cli.mjs keygen 'C:\Recuperacao\ChavesNovas'
```

O diretório pai deve existir e o destino das chaves deve ser novo. No Windows, proteger a pasta com ACL do usuário administrador e criptografia do disco; `chmod` sozinho não implementa uma ACL Windows. Enviar ao painel apenas `luta-recovery.public.pem`, confirmar a guarda da chave privada e salvar a política. Gerar o primeiro backup e baixar a cópia.

```powershell
node backup-cli.mjs restore 'C:\Backups\backup.lpcb' 'C:\Chaves\luta-recovery.private.pem' 'C:\Recuperacao\EnsaioNovo'
node backup-cli.mjs copy 'C:\Backups\backup.lpcb' 'E:\BackupsLuta'
```

`restore` recusa destino existente e cria um relatório `restore-report.json`. A pasta recuperada contém dados privados em claro: restringir o acesso, usar disco criptografado e removê-la conforme o procedimento institucional após o ensaio. Registrar o relatório no painel. O registro é uma declaração auditada do administrador com correspondência de identificador, hash e contagens, não uma atestação independente.

Para ensaio funcional, usar uma cópia isolada, instalar dependências pelo lockfile, configurar `PORTAL_DATA_DIR` para a base recuperada e manter email, WhatsApp, ingresso público e a rotina de backup DESATIVADOS. Não carregar `configuration.json` diretamente em um servidor de teste. Conferir cadastros, turmas, chamadas, agenda e abertura de documentos sem alterar produção ou enviar mensagens.

Em desastre real: preservar evidências, escolher a última cópia íntegra anterior ao incidente, validar procedência/hash, recuperar em ambiente novo, revisar credenciais e DNS, testar as funções críticas e somente então trocar o serviço. O tempo medido pela ferramenta cobre extração e integridade; não representa o RTO de toda a aplicação. Medir também provisionamento, instalação, validação e troca de tráfego.

## Google Drive automático

Preparar um cliente OAuth institucional com API do Drive habilitada. Preferir o escopo `https://www.googleapis.com/auth/drive.file`, que limita acesso a arquivos e pastas criados ou explicitamente abertos com o aplicativo. Uma pasta criada pelo navegador precisa ser selecionada/autorizada pelo Google Picker; alternativamente, criar a pasta pela própria integração. Não ampliar para todo o Drive apenas para contornar esse requisito.

Após consentimento do administrador institucional e emissão segura do refresh token com acesso offline, configurar no Render: `BACKUP_DRIVE_CLIENT_ID`, `BACKUP_DRIVE_CLIENT_SECRET`, `BACKUP_DRIVE_REFRESH_TOKEN`. Não colocar segredos no GitHub, no formulário público, em mensagens ou capturas. Usar app interno do Workspace ou configuração de produção adequada; tokens de aplicativos externos em teste podem expirar.

Informar o ID da pasta no painel. A integração verifica permissão de gravação, procura o mesmo identificador antes de repetir upload e compara tamanho e MD5 retornados pelo Drive; o pacote mantém seu SHA-256 para recuperação. Uma falha externa preserva o arquivo local e mantém o alerta. O envio seguinte usa um novo pacote; uma cópia antiga pode ser reenviada pelo botão do painel. Não há apagamento remoto nem alteração de compartilhamento.

## Retenção e rotina de conferência

Política inicial sugerida, a validar com o tamanho real e a obrigação de retenção dos dados: cópias recentes de quatro em quatro horas por sete dias; uma diária por 30 dias; uma mensal por 12 meses. Nesta versão, a seleção e o descarte são procedimentos administrativos, não rotação automática. Conferir semanalmente espaço do Render, Drive e computador. Nunca remover a última cópia recuperável; antes de descartar uma cópia local, conferir a cópia externa e um ensaio recente. Se o volume crescer, migrar o destino principal para armazenamento com retenção imutável e alertas independentes do servidor.

Todos os dias: conferir execução recente e envio externo. Semanalmente: atualizar mídia offline e conferir hash. Mensalmente e após mudança importante: ensaio de recuperação. O painel alerta administradores para backup atrasado, última falha, cópia automática externa pendente e ausência de relatório de restauração nos últimos 30 dias com a chave atual. Esse aviso depende de o sistema estar disponível; monitoramento independente de indisponibilidade é uma camada adicional.

### Emails de acompanhamento

Com a rotina de backup ativada, administradores ativos recebem individualmente um resumo diário a partir das 8h de Brasília e alertas de falha na geração, atraso ou cópia externa pendente. O processo verifica a situação a cada cinco minutos e após a execução automática; uma falha manual é percebida na próxima verificação. Cada tipo de problema abre um incidente e não repete seu alerta enquanto permanecer aberto. Um problema novo, após resolução, abre outro incidente. O resumo informa quantos pacotes foram criados e confirmados no Drive nas últimas 24 horas, mesmo que a automação externa ainda esteja pendente.

O email não contém dados de alunos, anexos ou chaves. A fila persiste no SQLite, revalida destinatários antes do envio, cancela alertas já resolvidos e usa conteúdo e chave de idempotência fixos nas novas tentativas. Atrasos de rede têm repetição limitada à janela de 23 horas; depois disso, exige conferência do provedor para evitar duplicação além da janela de 24 horas do Resend. Rejeições permanentes e confirmações ausentes aparecem no painel. "Aceito pelo serviço de email" não significa entregue ou lido. O mecanismo depende de servidor e Resend disponíveis e não substitui monitoramento externo de indisponibilidade total.

## Fontes primárias e fundamento

Estas decisões se baseiam em práticas documentadas de engenharia e segurança, não em uma alegação de certificação científica.

- SQLite, snapshot de banco em uso: https://sqlite.org/backup.html
- Moodle, recuperação de aplicação educacional exige banco, arquivos e código: https://docs.moodle.org/405/en/Site_backup
- GitLab, escopo de backup e preservação separada de configuração/segredos: https://docs.gitlab.com/administration/backup_restore/backup_gitlab/
- CISA, cópias offline criptografadas e ensaios regulares: https://www.cisa.gov/stopransomware/ransomware-guide
- Render, limitações de snapshots e discos persistentes: https://render.com/docs/disks
- Google, uploads: https://developers.google.com/workspace/drive/api/guides/manage-uploads
- Google, acesso por arquivo: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Google, OAuth offline: https://developers.google.com/identity/protocols/oauth2/web-server#offline
- Resend, idempotência e janela de 24 horas: https://resend.com/changelog/idempotency-keys
