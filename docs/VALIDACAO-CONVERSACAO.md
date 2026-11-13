# Validação da conversação e dos convênios — 07/11/2026

## Resultado

O fluxo de catálogo usa os dados de convênio das clínicas e o mesmo filtro SQL utilizado na busca convencional. A interpretação separa entidades, filtros e conjunto de clínicas. Uma pergunta contextual não expande silenciosamente a comparação para toda a base.

## Evidências executadas

| Verificação | Resultado |
| --- | --- |
| `npm run check` | Aprovado: lint, tipagem, build e 591 testes em 18 arquivos. |
| `npm run test:e2e` | Aprovado: 60 testes, 30 desktop e 30 mobile. |
| Combinações clínica/convênio | 50 × 35 = 1.750 combinações verificadas contra o cadastro, incluindo ausências. |
| Vínculos positivos individuais | Todos os 105 vínculos existentes foram consultados no chat com contexto restrito à unidade. |
| Busca geral por operadora | Todos os 35 nomes cadastrados comparados com a busca do repositório SQL. |
| Cadastro dinâmico | Novo plano e nova clínica importados em banco de teste; consultas funcionaram sem alterar regras. |
| Marca com várias unidades | Pede identificação quando o conjunto excede o limite de contexto; não produz resposta inválida. |
| Segurança | Urgência, medicamentos e troca de pessoa/queixa cobertas pelos testes existentes e pelas novas regressões. |

A suíte E2E utilizou o servidor da aplicação e PGlite em memória, com catálogo público e provedor de demonstração. O Chromium comum do ambiente não iniciou por restrição a sockets; a execução aprovada usou Chrome Headless Shell via `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, sem alterar a configuração padrão do projeto. No Windows, o comando normal usa o Chromium instalado pelo Playwright.

As suítes validam também os adaptadores e contratos dos provedores com respostas controladas. Não foi executada uma sessão com os pesos reais do Qwen/Ollama nem uma chamada real à OpenAI nesta entrega.

## Mudanças de implementação

| Arquivo | Mudança |
| --- | --- |
| `server/domain/insurance.ts` | Resolve nomes e aliases com o catálogo atual; trata variações de espaço, acentos, pontuação e ambiguidade; identifica plano não reconhecido. |
| `server/domain/language-intents.ts` | Reconhece ampliação da busca, remoção de filtro e posições das clínicas mostradas. |
| `server/services/chat-intent.ts` | Separa busca geral de seleção anterior; resolve plano explícito antes do filtro herdado; preserva contexto de esclarecimentos. |
| `shared/contracts.ts` | Acrescenta contexto opcional de catálogo com escopo, conjunto de comparação e estado de esclarecimento. Continua aceitando o contexto anterior. |
| `server/services/chat.ts` | Produz respostas de cobertura a partir de SQL, preserva comparação vazia e agradecimentos, aplica plano junto do sintoma e retoma navegação após esclarecer o plano. Consultas de catálogo dispensam geração e embeddings. |
| `server/domain/guardrails.ts` | Usa o último turno do episódio clínico para perguntas que omitem o medicamento; mantém prioridade da segurança. |
| `src/features/chat/useChat.ts` e `ChatPanel.tsx` | Propagam os filtros resolvidos para os seletores compartilhados. Edição manual durante uma resposta pendente é preservada. |
| `tests/insurance-conversation.test.ts` | Acrescenta 215 testes e as verificações de todas as combinações do catálogo. |
| `e2e/insurance.spec.ts` | Acrescenta quatro jornadas, cada uma executada em desktop e mobile. |

Nenhuma migração ou nova dependência de produção foi necessária. `package.json`, `package-lock.json` e os dados reais do catálogo permanecem iguais aos do ZIP recebido.

## Semântica da memória

`context.clinicIds` registra as clínicas da última resposta. `context.catalog.clinicIds` preserva o conjunto usado na comparação. Perguntas que testam outro plano podem reutilizar esse conjunto mesmo depois de zero resultados. Referências explícitas às clínicas mostradas usam o conjunto mostrado; um pedido de busca geral abre um novo escopo.

IDs recebidos do navegador são revalidados pelo SQL quanto à existência, atividade, validade cadastral e especialidades ativas. Esse contexto não autoriza acesso a registros invisíveis nem fornece prova de cobertura.

O contexto permanece em memória e o histórico enviado continua limitado às seis mensagens anteriores do usuário. O recurso não cria memória ilimitada entre sessões.

## Limites e dados pendentes

Das 50 unidades, apenas 10 têm planos informados, totalizando 105 vínculos com 35 nomes distintos. As 40 listas vazias foram preservadas como informação ausente. Preenchê-las exige verificar as fontes de cada unidade; não foi inventada cobertura nesta entrega.

O cadastro não especifica produto/subplano, procedimento ou profissional para cada convênio. Uma correspondência de operadora não confirma essas condições específicas. Planos desconhecidos e escolhas ambíguas exigem esclarecimento. Consultas de vários convênios de uma vez pedem a escolha de um por consulta.

A busca geral considera toda a base visível e mostra até três cards por resposta, conforme o comportamento do produto. O diretório mantém sua paginação.

A matriz cobre integralmente as combinações dos dados deste catálogo, não todas as formas possíveis de linguagem natural. Os guardrails e a indicação de especialidade não constituem validação clínica nem garantem detecção de toda urgência.

O build aprovado ainda apresenta o aviso já existente de bundle JavaScript superior a 500 kB; ele não impede a geração do aplicativo.
