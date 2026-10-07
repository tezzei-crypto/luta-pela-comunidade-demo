# Luta pela Comunidade

Site público e portal privado em HTML, CSS e JavaScript, com Node.js 24 e SQLite. O código público não contém dados de alunos, documentos ou credenciais.

## Execução e verificação

- Build: npm test
- Start: node server.mjs
- Health check: /api/health
- Administração: /administracao/
- Ficha do aluno/responsável: /portal/

## Armazenamento privado no Render

Requer serviço pago com disco persistente montado em /var/data. Configure PORTAL_DATA_DIR=/var/data/luta, PERSISTENT_STORAGE_CONFIRMED=true, PORTAL_SECRET com pelo menos 32 caracteres aleatórios, BOOTSTRAP_ADMIN_EMAIL e PUBLIC_ORIGIN. Configure RESEND_API_KEY e MAIL_FROM para os códigos de acesso e notificações. Nunca grave os valores secretos no repositório.

O administrador inicial entra por código de uso único enviado ao email configurado. Responsáveis e profissionais só acessam alunos vinculados pela equipe. IDs públicos não autenticam uma pessoa nem expõem nomes e documentos.

Importe o CSV inicial no portal ou com node portal-maintenance.mjs import /caminho/privado/alunos.csv. Preserve os IDs existentes. Ative PORTAL_REGISTRY_ACTIVE=true somente depois da conferência da importação. PORTAL_INTAKE_ACTIVE=true grava novas inscrições e arquivos no disco privado. METRICS_ENABLED=true oferece estatísticas opcionais nas páginas públicas, com consentimento.

## Backup e limites

node portal-maintenance.mjs backup cria cópia consistente do SQLite. Uma recuperação completa também exige copiar a pasta privada objects/ e guardar o segredo em destino seguro externo ao disco. Teste a restauração. Validação de formato não equivale a antivírus. Aprovação documental, vínculos e confirmação de horários dependem da equipe.

render.yaml serve como referência para configurar o serviço existente; não crie outro serviço acidentalmente. Não envie bancos, CSV de alunos, documentos ou arquivos .env ao GitHub.
