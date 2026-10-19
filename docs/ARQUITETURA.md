# Arquitetura MedFinder 2.3

## Responsabilidades

1. **Guardrails:** `detectUrgency` avalia relato e histórico antes da IA. Um alerta determinístico não pode ser reduzido pelo modelo, pela localização ou por feedback. Emergência e avaliação no mesmo dia não listam clínicas eletivas.
2. **Intenção e LLM:** após guardrails, `chat-intent.ts` identifica sintomas, pesquisas de clínicas e pedidos de informação. Nomes/aliases de especialidades, clínicas, cidades e convênios vêm do banco. Consultas ao catálogo dispensam geração. Para sintomas, o LLM recebe mensagem/histórico redigidos, perguntas anteriores controladas e a taxonomia ativa; sugere uma candidata ou `null`. Não recebe clínicas, coordenadas ou feedback. JSON Schema e Zod controlam a estrutura.
3. **SpecialtyResolver:** resolve nomes e aliases normalizados por acento/caixa usando `SpecialtyRepository`. Não usa similaridade vetorial nem fuzzy matching. A taxonomia é administrativa, no banco.
4. **CatalogRepository:** fonte de verdade de clínicas, convênios, cidades, endereços, serviços cadastrados e coordenadas. SQL parametrizado filtra atividade, especialidade ativa, convênio exato, cidade exata e palavras opcionais. Não recebe texto arbitrário da IA como SQL.
5. **Proximidade:** Haversine calcula quilômetros em linha reta somente para registros com coordenadas. Ordena todos os candidatos antes de paginar. Sem coordenadas ficam por último; desempate estável por nome e ID. Sem localização, cadastros reais primeiro e nome/ID.
6. **RAG de clínicas:** complementa a resposta com trechos e fontes dos candidatos já selecionados. Não escolhe a especialidade nem amplia filtros. Os trechos são exibidos separadamente, sem uma segunda síntese clínica pelo modelo.
7. **FeedbackRepository:** emite comprovantes e grava avaliações. Não lê nem grava conversas. Não se conecta à IA ou altera os guardrails.

## Especialidades

`specialties` armazena ID, nome, nome normalizado, aliases, atividade e datas. `clinic_specialties` mantém a relação com integridade referencial. A API monta `{id,name}` diretamente do banco; filtros e cards não importam uma lista fixa do frontend.

`specialty_reference` é um vocabulário administrativo separado para reconhecer um nome válido ainda não habilitado. Inicialmente contém a taxonomia cadastrada e Pediatria, Geriatria e Radiologia. A migração 10 promove Pediatria para a taxonomia ativa. Referência de nomenclatura: [CFM, Resolução 2.380/2024](https://sistemas.cfm.org.br/normas/visualizar/resolucoes/BR/2024/2380). Não se trata de uma lista exaustiva nem de validação automática da pertinência clínica da indicação. Psicologia é uma área de cuidado preservada do catálogo anterior.

Resolução ativa retorna `resolved`. Nome só na referência, ou cadastro inativo, retorna `not_registered`. Nome sem correspondência exata/alias explícito retorna `unrecognized`: o LLM não pode declarar sozinho que uma especialidade desconhecida é válida. O comando administrativo `data:import -- specialties` adiciona/atualiza nome, aliases, referência e atividade; conflitos entre nomes/aliases são rejeitados em transação.

Apenas **uma especialidade canônica ou nenhuma** determina a busca de cuidado. A migração 8 acrescenta aliases explícitos, incluindo “oculista”, “oftalmo”, “dermato”, “neuro”, “cardio” e “uro”. Não cria especialidades por saída de IA e não reativa cadastros. Um rótulo desconhecido, inativo ou insuficiente produz fallback sem clínicas, sem o nome original e sem alternativas.

A defesa tem quatro camadas: taxonomia ativa fornecida ao modelo, Structured Output singular, resolução exata no banco e apresentação controlada. `answer` e `reason` gerados continuam sujeitos aos guardrails, mas **não são publicados**; `questions` aceita apenas códigos de tópicos: o backend apresenta mensagens próprias e a entidade resolvida. Isso impede que um alias ou uma especialidade inventada escape pelo texto livre, mesmo quando a candidata principal é válida.

A migração 9 desativa `medicina-de-familia`. O registro e as relações históricas permanecem no banco, mas a área sai da lista fornecida ao modelo, da resolução ativa, dos filtros e dos cards. O snapshot e o texto público da Clínica FAM mantêm somente Ortopedia e Dermatologia dentro do escopo do produto. A clínica permanece no catálogo. Isso é uma escolha de escopo do MedFinder, não uma afirmação sobre o reconhecimento profissional dessa especialidade.

## Esclarecimento condicional

`server/domain/clarification.ts` reconhece relatos claramente genéricos, como dor de cabeça/pescoço sem características, e identifica dados já fornecidos. Isso não é um formulário obrigatório: duração e todas as outras categorias não precisam estar preenchidas. Características, circunstâncias, sintomas associados ou uma descrição mais rica podem permitir uma orientação. Descrições não cobertas pelos padrões linguísticos ficam a cargo do modelo. Trata-se de heurística de linguagem, não validação clínica.

Um relato não genérico com candidata válida segue para resolução no banco. Perguntas opcionais e `urgency=uncertain` não anulam essa candidata; a incerteza é preservada na resposta. Se não houver candidata, não se inventa uma especialidade ou uma nova lista de perguntas para um relato detalhado. Relatos genéricos e idade necessária podem gerar até duas perguntas por rodada, com limite de três rodadas.

`patient.ts` identifica a idade de quem apresenta o sintoma, separando-a da idade do responsável. Filha/filho não implica menor de idade. Idade desconhecida numa possível criança é perguntada antes de recomendar; anos, meses, números por extenso e uma resposta curta como “5” são aceitos. Duração de sintomas não é idade. Nova pessoa reinicia o contexto. A API e o frontend aceitam mensagens a partir de um caractere não vazio.

O perfil derivado (`relationship`, `ageYears`, `adultReported`, `needsAge`) vai ao modelo junto do relato redigido; não contém nome ou nascimento. O prompt instrui a considerar Pediatria para a avaliação inicial de queixas inespecíficas de crianças/adolescentes, sem encaminhar toda criança obrigatoriamente para essa área. Uma filha explicitamente adulta ou com 20 anos ou mais não recebe Pediatria neste MVP. Esse limite conservador do produto não substitui a política etária de cada serviço. Faixa etária efetivamente atendida deve ser confirmada com a unidade.

`care.questions`, `care.askedTopics` e `care.round` ficam em memória. O histórico recente e as perguntas anteriores acompanham a resposta seguinte. A idade também é reconstruída a partir das mensagens, sem tabela de pacientes ou persistência da conversa. Guardrails continuam examinando todo o histórico antes do recorte de contexto. Após três rodadas sem conseguir orientar, não se força indicação.

## Explicação e prioridade presencial

`care-explanation.ts` apresenta uma descrição breve controlada, vinculada ao relato e à área validada. Ouvido e coceira na pele têm descrições específicas de possibilidades, com referências públicas; outras situações usam uma explicação geral de investigação do desconforto. Não são diagnóstico, prescrição ou resumo clínico obtido do RAG. `answer` e `reason` livres do LLM continuam sem ser publicados.

Fontes editoriais de orientação aparecem em `sources` sem `clinicId` e se somam às fontes cadastrais recuperadas pelo RAG. `ragStatus` continua descrevendo apenas o índice de clínicas. Referências de orientação não são prova de validação médica do motor de indicação.

O caso reproduzido da imagem — desconforto no ouvido após uso de lápis — aciona um sinal conservador de possível lesão: avaliação presencial no mesmo dia, sem perguntas, geração ou clínicas eletivas. A área relacionada Otorrinolaringologia aparece apenas se estiver ativa no banco. Alertas de emergência já detectados continuam prevalecendo; não se reduz uma emergência para esse fluxo.

Fontes consultadas em 18/10/2026: [NHS — Earache](https://www.nhs.uk/symptoms/earache/), [NHS — Perforated eardrum](https://www.nhs.uk/conditions/perforated-eardrum/), [NHS — Itchy skin](https://www.nhs.uk/symptoms/itchy-skin/) e [SBP — Pediatria e adolescência](https://www.sbp.com.br/sbp-destaca-papel-do-pediatra-nos-cuidados-com-os-adolescentes/). Não foi criado um protocolo clínico validado.

## Contrato e falhas

O modelo retorna `answer`, `urgency`, `specialty:{name,reason}|null` e `questions`. Limites: zero ou uma candidata, dois tópicos de pergunta, resposta até 1800 caracteres e justificativa até 240. Campos extras e o antigo array são rejeitados. O prompt tem versão `care-navigation-2.3.0`.

`care_navigation` cobre relatos; `clinic_search` consulta especialidade/convênio/cidade/proximidade; `clinic_information` busca fatos de uma unidade. Não há dedução de endereço, contato, plano, horário, serviço ou distância pela memória do LLM. Quando faltam convênio ou unidade identificável, pede esclarecimento. Múltiplas especialidades na mesma consulta também pedem uma escolha.

O frontend devolve contexto curto `{specialtyId,clinicIds,city,insurance}` para continuidades como “dessas” ou “e que aceite Unimed?”. O backend trata-o como não confiável: valida IDs, atividade e filtros novamente. Nada é persistido, nem incluído na entrada do LLM. A história continua limitada a seis mensagens do usuário. Segurança é avaliada antes de toda intenção. Consultas OpenAI sem consentimento usam somente o catálogo e pulam embeddings externos.

`status` distingue `llm_unavailable`, `invalid_output`, `needs_information`, `specialty_unrecognized`, `specialty_not_registered` e `no_matching_clinics`. `ragStatus` é separado: `skipped`, `not_indexed`, `available`, `no_matches`, `unavailable`. Uma falha de embedding não descarta especialidade e clínicas já encontradas. Falhas de banco são erros HTTP de serviço; não são rotuladas como falha da IA.

O modo demo usa casos sintéticos fixos para testar navegação, não inferência clínica. Ollama e OpenAI usam o mesmo contrato. Ollama verifica modelo local antes de enviar texto; OpenAI usa Responses, Structured Outputs e `store:false`. Nenhum erro bruto de SDK é registrado.

## Localização e minimização

`useGeolocation` pertence ao App e é compartilhado entre chat e diretório. Só chama `getCurrentPosition` após clique, com baixa precisão, timeout de 10 segundos e cache do navegador de até 5 minutos. Negação não dispara nova solicitação automática. Cancelar/remover invalida callbacks pendentes.

O frontend envia apenas latitude/longitude arredondadas a quatro casas, em corpos POST; `accuracy` fica no hook. O servidor valida valores finitos e limites. `AIProvider.generate` recebe uma allowlist explícita de campos; o Retriever recebe consulta textual e IDs de clínicas, sem posição do usuário. `locationUsed` é um booleano da resposta, sem guardar coordenadas.

As coordenadas da clínica são dados administrativos persistentes; a posição do usuário e `distanceKm` calculada nunca são persistidas. O bug de distância indisponível vinha do snapshot com **20 pares nulos**, não da permissão do navegador: Haversine corretamente não calculava sem o segundo ponto. O snapshot 2.1 tem **36 pares verificados por unidade**, com auditoria em `data/coordinates.provenance.json`. Importação preserva coordenadas administrativas mais recentes. Não há geocodificação durante o chat. Cidade vazia permite cidades vizinhas; cidade selecionada permanece um filtro exato. Geolocalização não determina urgência, tempo de viagem ou qualidade médica.

## Feedback e proteção contra falsificação

Cada resposta tem UUID aleatório e um token aleatório de 256 bits. Só o hash do token é persistido em `response_receipts`, junto do modo, versão do prompt, motivos permitidos e data. O navegador mantém o token apenas na memória da conversa. O servidor não aceita modo/versão/motivos fora do comprovante.

`POST /api/feedback` faz UPSERT por `response_id`. Negativo exige motivo contextual; comentário opcional tem até 500 caracteres e passa por `redactIdentifiers`. Positivo limpa motivo/comentário anteriores. Não há endpoint público de leitura das avaliações. Comprovantes expiram em 7 dias; a CLI de limpeza remove os vencidos sem apagar os votos existentes. Configure uma política administrativa de retenção do feedback conforme o uso real.

A conversa não depende do feedback: erro na emissão ou no envio não impede o chat. Não há treinamento, fine-tuning, mudança de prompt ou uso de votos no próximo contexto. A redação de identificadores é limitada e não impede que o usuário inclua voluntariamente informações sensíveis num comentário; a UI orienta a evitar isso.

## Migrations e compatibilidade

Migrações 1–9 não foram alteradas nesta atualização. Histórico de `evolution-migrations.ts`:

| Versão | Mudança                                                                                                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 5      | Taxonomia, referência, `clinic_specialties`; migra os IDs existentes e remove o antigo array SQL                                   |
| 6      | Coordenadas nullable, `clinic_documents`, `clinic_chunks` com pgvector; renomeia documentos/chunks médicos para `legacy_medical_*` |
| 7      | `response_receipts` e `ai_feedback`                                                                                                |
| 8      | Acrescenta aliases explícitos na taxonomia e referência existentes, preservando atividade e evitando colisões                      |

A migração **9** desativa Medicina de Família e Comunidade. A **10** insere Pediatria a partir da referência já existente, sem substituir um cadastro do operador nem reativar registros desativados por ele.

As tabelas médicas anteriores são preservadas para auditoria/migração administrativa, sem leitores no fluxo ativo. O antigo arquivo `knowledge.demo.json` foi removido. `integration_state` continua apenas como registro legado da integração antiga. Não se cria PostGIS. A mesma SQL usa PostgreSQL/PGlite e a extensão pgvector.

## Limites de escala e validação

O catálogo do MVP é pequeno: distância é calculada em memória sobre todos os registros já filtrados no SQL, depois ordenação e paginação. Antes de ampliar muito o volume, medir memória/latência e adaptar a estratégia. Busca vetorial é exata e restrita por modelo/dimensão em CTE materializada. Veja [RAG.md](RAG.md).

Rate limits são por processo, não uma autorização de identidade. O acesso ao CLI/banco é administrativo. Proxy/APM não devem capturar corpos de saúde, comentários ou localização. Prontidão não comprova conectividade do modelo, revisão clínica ou qualidade dos cadastros; `integrations:check` faz teste técnico sintético explícito.
