# Limite de faltas e fotos privadas das aulas

Esta entrega do Luta pela Comunidade parte da versão publicada e mantém o prazo
de 12 horas para chamada, os cadastros, a agenda e as regras de graduação.

## Limite configurável

Em **Relatório de presença → Configurar limite de faltas consecutivas**, somente
o administrador geral altera a regra global. O padrão continua 3; aceita inteiros
de 1 a 30. A prévia informa o número estimado de alertas ativos após a alteração,
sem gravar ou enviar mensagens. Salvar exige a prévia e o motivo. Versões impedem
que uma alteração sobrescreva outra feita simultaneamente.

Presença, justificativa e registro desconhecido interrompem a sequência na mesma
turma. Aulas canceladas ficam fora. Alterar o limite recalcula os sinais e preserva
acompanhamentos e avisos já aceitos pelo provedor. Avisos ainda não tentados podem
ser retomados se o episódio voltar a ser elegível; mensagens já tentadas não são
reenviadas por uma simples mudança de regra. Novos alertas podem avisar a equipe
pelo fluxo existente. As marcações de presença não são alteradas.

## Foto da aula

Em **Presença → abrir chamada → Foto da aula**, o professor vinculado à turma ou
a equipe administrativa pode enviar câmera/arquivo de até 8 MB, em JPG, PNG ou
WebP estático. O servidor decodifica e reprocessa o arquivo, limita a quantidade de
pixels, remove metadados e guarda JPEG privado. Não aceita SVG, PDF ou arquivo
apenas renomeado. O acesso exige autenticação e permissão sobre a aula; respostas
não são armazenadas em cache. Não existe endereço público para a foto.

Cada novo envio preserva as fotos anteriores e volta para conferência. A equipe
pode conferir ou solicitar outra foto com motivo. Alterações posteriores na
chamada invalidam a conferência anterior até nova revisão. O identificador de
envio evita duplicação quando a conexão cai e a pessoa tenta novamente. Data
futura e aula cancelada não aceitam novos envios. Limite: 20 fotos por aula.

A foto é um registro para revisão humana, não prova automática da identidade,
da data da captura ou da presença de cada aluno. Ela não marca a chamada nem
publica imagens no site. Nesta entrega, a foto não impede salvar a chamada;
alterar essa exigência não faz parte do editor de limite de faltas.

## Fundamentação e verificação

- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html): validação, reprocessamento, limites, armazenamento privado e autorização.
- [W3C/WAI — notificações em formulários](https://www.w3.org/WAI/tutorials/forms/notifications/): feedback claro, erro acessível e preservação dos campos.
- [IES — Chronic Absenteeism](https://nces.ed.gov/use-work/supporting-recovery-with-evidence-based-practices/chronic-absenteeism): dados de frequência podem apoiar identificação precoce e acompanhamento. Evidência escolar não valida automaticamente um limite específico para jiu-jitsu.

O número de faltas é uma decisão operacional da gestão. Estas referências não
equivalem a uma certificação científica, de segurança ou acessibilidade.

Regressões novas cobrem regras 1/3/5, impacto sem efeitos, histórico, permissões,
persistência, concorrência, fila de avisos, imagem inválida, tipo divergente,
remoção de metadados, repetição de upload, privacidade HTTP, mudança da chamada,
campos preservados após falha e restrições da interface por função. Os testes usam
somente dados fictícios em armazenamento isolado. Testes DOM não verificam a
câmera ou o comportamento de um aparelho físico.

## Integração com secretarias por núcleo

A mudança de permissões por núcleo continua em revisão separada. Ao integrá-la,
as operações `classEvidence`, `addClassPhoto`, `classPhoto` e `reviewClassPhoto`
devem validar o núcleo da aula, e `absencePolicy` pode ser lida localmente sem
histórico global; sua escrita permanece exclusiva do administrador geral.
