# Luta pela Comunidade

Este repositório atende exclusivamente o Luta pela Comunidade, em https://www.lutapelacomunidade.com.br/. Não confundir com o projeto jiujitsunasescolas nem publicar uma cópia antiga de outro diretório.

## Verificação solicitada pela gestão

- Revise o código de cada alteração e seus efeitos nos módulos relacionados, nas permissões, na persistência, nos dados privados e nas mensagens apresentadas ao usuário.
- Fundamente decisões pertinentes em fontes primárias: documentação oficial, W3C/WAI, OWASP e pesquisas relevantes ao contexto. Diferencie evidência científica, padrões de engenharia e regras escolhidas pela gestão. Não atribua eficácia científica a uma funcionalidade sem evidência apropriada.
- Execute a suíte completa com `node --test *.test.mjs` em Node.js 24, após instalar as dependências. Acrescente testes de regressão quando corrigir falhas ou introduzir comportamento relevante.
- Confira no navegador os fluxos afetados e suas integrações; valide celular e computador quando houver mudanças de interface. Inclua sucesso, validação de entradas, falha, repetição e permissões conforme a mudança.
- Use dados fictícios e armazenamento isolado nos testes automatizados. Preserve inscrições, chamadas, agenda e documentos reais. Não envie mensagens nem registre presenças, aprovações ou atendimentos reais como teste sem autorização específica.
- Antes de concluir uma publicação autorizada, confira os arquivos publicados, o resultado do build, a saúde do serviço e o comportamento da versão em produção. Não substitua a base persistente por dados de teste.
- Informe resultados e limitações de forma verificável. Uma suíte aprovada não significa cobertura de todos os cenários, ausência de defeitos ou certificação científica/de acessibilidade. Percentuais de progresso precisam de critérios e devem distinguir código pronto, publicação e validação operacional.

## Publicação

O serviço existente fica no Render e usa disco persistente para SQLite e arquivos privados. `render.yaml` é referência para o serviço existente. Não crie outro serviço sem necessidade. Não envie bancos, documentos, arquivos `.env`, credenciais ou `node_modules` ao repositório.

Build atual: `npm install --ignore-scripts --no-audit --no-fund && npm test`.
Inicialização: `node server.mjs`. Saúde: `/api/health`.
