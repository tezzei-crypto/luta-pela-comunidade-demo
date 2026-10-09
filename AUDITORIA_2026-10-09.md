# Auditoria de código e regressão — 9 de outubro de 2026

Projeto: Luta pela Comunidade. Escopo: código do servidor e das interfaces, permissões, persistência, inscrições, frequência, graduação, edição e, em especial, agendamentos. Testes exclusivamente com dados fictícios e bancos isolados.

## Resultado reproduzível

- Node.js 24.19.0: `node --test --experimental-test-coverage *.test.mjs` — **232 testes aprovados, zero falhas**, em 31,34 segundos.
- Os 232 incluem nove cenários da interface executados em DOM simulado (JSDOM), além do teste que executa esse conjunto. Não equivalem a 232 jornadas manuais nem a validação visual em dispositivos reais.
- Análise estática: 109 arquivos JavaScript/MJS com sintaxe válida; 14 páginas, 402 referências verificadas, sem referências locais ausentes ou IDs duplicados. Busca heurística sem indícios de segredos no conteúdo público, sem garantia de detecção absoluta.
- Cobertura dos arquivos carregados pelo coletor: 96,93% das linhas, 84,89% dos ramos e 92,67% das funções. Não representa cobertura de todo o produto: processos separados e parte da interface ficam fora dessa medição.
- Auditoria das dependências: zero vulnerabilidades conhecidas na consulta realizada após atualização do Sharp para 0.35.5. Incluídos arquivo de versões travadas e dependências de teste no build.

## Falhas corrigidas

1. Agenda: incompatibilidade entre modalidade solicitada e horário; repetição de solicitação já gravada depois do início do atendimento; divulgação prematura de link de reunião na API; filtros aplicados depois de limite de resultados; inconsistência entre reserva pública e privada em outro núcleo.
2. Avisos: reservas privadas agora participam da fila durável de envio; cancelamentos e atendimentos encerrados deixam de disparar avisos pendentes. Retentativas mantêm conteúdo e chave idempotente. Concessões temporárias de processamento evitam dois processos enviarem simultaneamente. Pendências antigas ou além da janela segura ficam para revisão, sem retentativa cega.
3. Interface: trava contra duplo envio, recuperação de erro sem perder campos/protocolo, validação da confirmação recebida, descarte de respostas antigas ao trocar serviço ou seleção do calendário. O painel preserva o conteúdo dos formulários antes de desabilitar seus controles.
4. APIs: corpos JSON nulos, arrays ou valores primitivos recebem erro de validação em vez de falha interna.
5. Chamadas: retomada de aviso anteriormente suspenso preserva conteúdo e idade da tentativa, sem alterar o corpo sob a mesma chave idempotente.
6. Dependências: atualização do Sharp corrige vulnerabilidade conhecida de processamento de imagens.

## Cenários de maior risco exercitados

- Matriz de 25 transições de situação; cancelamento, confirmação, conclusão, falta, reabertura inválida e passagem do horário.
- Remarcação atômica, conflitos, versões antigas, repetição, confirmação explícita e preservação da reserva anterior quando a operação falha.
- Oito processos de execução concorrente disputando a mesma vaga: uma reserva aceita e sete conflitos, sem duplicidade.
- Perfis de administrador, secretaria, profissional, professor, responsável vinculado e pessoa sem vínculo; autorização atual do profissional e núcleo.
- Falha de transporte, retomada após interrupção, vencimento de concessão de envio, destinatário revogado, payload estável e limite de 23 horas para retentativas automáticas.
- Limites de datas/duração, horários adjacentes e sobrepostos, URLs e mais de mil horários em outros núcleos.
- Interface: clique duplicado, resposta sem protocolo, protocolo incorreto, estado inconsistente, falha de conexão, preferência sem vaga reservada e respostas fora de ordem.

## Fundamentos

As decisões seguem padrões de engenharia e testes reproduzíveis; não constituem certificação científica ou garantia de ausência de defeitos. Os prazos de chamada e regras de graduação são regras da gestão, não resultados científicos.

- [NIST — testes combinatórios](https://csrc.nist.gov/projects/automated-combinatorial-testing-for-software): combinações e interações de estados e permissões.
- [SQLite — isolamento](https://www.sqlite.org/isolation.html): transações e exclusão de escritores para impedir disputa pela mesma vaga.
- [OWASP — autorização](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): validar autorização em cada operação e negar acesso por padrão.
- [W3C/WAI — notificações de formulários](https://www.w3.org/WAI/tutorials/forms/notifications/): mensagens de erro e sucesso identificáveis, com possibilidade de correção.
- [Resend — chaves de idempotência](https://resend.com/docs/dashboard/emails/idempotency-keys): validade de 24 horas; limite automático de 23 horas e conteúdo preservado.
- [Aviso de segurança do Sharp](https://github.com/advisories/GHSA-wq5f-xc86-pv6w): atualização da dependência afetada.

## Limites e operação

Aceitação pelo provedor de email não comprova chegada à caixa de entrada. Testes automatizados não substituem observação operacional. A suíte não executa confirmação, cancelamento, chamada nem mensagens em registros reais.

A publicação e a conferência visual autenticada precisam ser registradas separadamente deste resultado local. O servidor local não ficou acessível ao navegador controlado neste ambiente; os cenários de interface foram executados em JSDOM. Para revisão manual isolada em ambiente que suporte localhost: `node browser-audit.mjs`, depois abrir `http://127.0.0.1:4319/`.

Reprodução: `npm ci --ignore-scripts --no-audit --no-fund`, `npm test`. A suíte completa executa também `browser-audit.test.mjs`. Auditoria de dependências: `npm audit`.
