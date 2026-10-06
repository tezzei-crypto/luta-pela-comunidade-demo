# Luta pela Comunidade — demonstração no Render

Pacote preparado para demonstração pública com dados fictícios. Não contém alunos reais, planilhas, documentos ou credenciais. O índice data/approved-students.json está vazio; não adicionar dados reais a este repositório.

## Render
Web Service; Language Node; Build Command: node --check server.mjs; Start Command: node server.mjs; Instance Type: Free; Root Directory vazio quando estes arquivos estiverem na raiz do repositório.

O servidor usa PORT e escuta em 0.0.0.0. RENDER_EXTERNAL_URL define a origem HTTPS esperada pelo servidor. Domínio personalizado: configurar PUBLIC_ORIGIN com sua origem HTTPS exata. Não é necessário informar IP externo.

## Teste
Acesse /agendamento/ e digite TREINO_UND1_000001. A ficha fictícia abre na mesma página. As solicitações simuladas não enviam email. A secretaria confirma atendimentos por WhatsApp; o treinamento não marca atendimento real.

Sem RESEND_API_KEY e MAIL_FROM, os envios permanecem indisponíveis. Não coloque senhas no GitHub. O banco persistente e a autenticação dos responsáveis ainda não estão implementados. O arquivo de cadastro local não serve para produção no plano gratuito.

O Render pode pausar serviços gratuitos após inatividade. Uma primeira visita pode levar algum tempo. Consulte https://render.com/docs/free.
