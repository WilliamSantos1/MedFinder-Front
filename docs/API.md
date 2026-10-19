# API HTTP — versão 2.3

Base local: `http://localhost:3001/api`. JSON UTF-8. Respostas da API usam `Cache-Control: no-store`. Contratos completos: `shared/contracts.ts`.

| Método | Caminho           | Função                                                                           |
| ------ | ----------------- | -------------------------------------------------------------------------------- |
| GET    | `/health`         | Processo ativo                                                                   |
| GET    | `/ready`          | Banco, taxonomia ativa e catálogo disponíveis; RAG opcional                      |
| GET    | `/catalog`        | Especialidades dinâmicas, cidades, convênios, modo e estado do índice textual    |
| GET    | `/clinics`        | Busca compatível sem localização                                                 |
| POST   | `/clinics/search` | Busca com filtros e posição opcional somente no corpo                            |
| POST   | `/chat`           | Navegação, especialidades validadas, clínicas, trechos e comprovante de feedback |
| POST   | `/feedback`       | Gravar/alterar avaliação de uma resposta                                         |
| POST   | `/visit-feedback` | Avaliar uma clínica indicada (nota 1–5) após o retorno do usuário                |

## Catálogo

`GET /catalog` retorna `specialties: [{"id":"urologia","name":"Urologia"}]`, além de `cities`, `insurances`, `mode`, `requiresConsent`, `chatTimeoutMs`, `demoData`, `directory` e `knowledge`. Este último campo foi mantido como metadado de compatibilidade: agora conta **documentos de clínicas**, não fontes médicas para escolher especialidade.

## Busca de clínicas

```json
{
  "city": "",
  "insurance": "Plano Exemplo A",
  "specialty": "urologia",
  "q": "",
  "page": 1,
  "location": { "latitude": -3.7319, "longitude": -38.5267 }
}
```

Envie para `POST /clinics/search`. Todos os filtros são opcionais; cidade/convênio até 80 caracteres, termo até 100 e página 1–1000. `specialty` é um ID de formato slug; a busca só encontra vínculos com especialidades ativas. `location`, se presente, exige dois números finitos: latitude -90..90 e longitude -180..180. Strings numéricas, pares incompletos, campos extras e coordenadas inválidas são rejeitados.

```json
{ "items": [], "total": 0, "page": 1, "pageSize": 6, "order": "proximity" }
```

Cada item mantém os campos de `Clinic`, com `specialtyDetails: [{id,name}]`, `accessNote: string|null` para regras de acesso publicadas e `distanceKm: number|null` computada. `order` é `name` ou `proximity`. Ordenação precede paginação sobre o conjunto completo filtrado. Cidade vazia permite todas as cidades; cidade selecionada é exata, ignorando acentos/caixa. Convênio também é exato. Não há substituições automáticas.

`GET /clinics?city=Fortaleza&insurance=CASSI&specialty=ortopedia&page=1` continua disponível, mas rejeita parâmetros de coordenadas. Não envie posição em URLs.

## Chat

```json
{
  "message": "Estou sentindo ardência ao urinar",
  "history": [],
  "city": "",
  "insurance": "",
  "consent": false,
  "location": { "latitude": -3.7319, "longitude": -38.5267 }
}
```

`message`: 1–2000 caracteres após trim; histórico: até seis mensagens do usuário, 1–2000 cada. A posição é opcional e só vai para o catálogo. `consent=true` é exigido antes de enviar textos à OpenAI. Respostas de segurança e consultas estruturadas ao catálogo funcionam sem consentimento; nesse caso o RAG com embeddings externos também é pulado. O gerador recebe mensagem/histórico redigidos, as perguntas anteriores reconstruídas pelo backend a lista dinâmica `{id,name}` de especialidades ativas e `reportedPatient`, um perfil derivado com parentesco, idade em anos quando identificada e necessidade de confirmar idade. O perfil não contém nome, nascimento ou posição e não é persistido.

Para continuidade, devolva opcionalmente o `context` recebido na resposta anterior:

```json
{
  "message": "e qual dessas fica mais perto?",
  "context": {
    "specialtyId": "oftalmologia",
    "clinicIds": ["public-cldo-aldeota"],
    "city": "",
    "insurance": ""
  },
  "location": { "latitude": -3.7319, "longitude": -38.5267 }
}
```

Use IDs efetivamente retornados pelo servidor; o exemplo ilustra o formato. Contexto não contém relato nem posição, é limitado a seis IDs e fica apenas na memória da aba/requisição. O backend revalida especialidade ativa, visibilidade e filtros das clínicas. Mudança manual dos filtros prevalece sobre o contexto anterior; “dessas” restringe aos IDs anteriores, enquanto “e que aceite Unimed?” refina a especialidade.

A resposta inclui:

- `id`: UUID emitido pelo servidor; `answer`, `urgency`, `questions`, `mode`, `notice`.
- `specialty`: **um** objeto canônico `{id,name,reason?}` ou `null`. Não há array de sugestões nem prioridades. A lista de serviços de cada clínica continua sendo uma lista.
- `intent`: `care_navigation`, `clinic_search` ou `clinic_information`; `mode=catalog` identifica consultas diretas ao catálogo, sem geração médica.
- `context`: `{specialtyId,clinicIds,city,insurance,care?}` ou `null`, para a próxima mensagem. `care` contém somente metadados dos esclarecimentos, descritos abaixo.
- `status` da resposta: `ok`, `llm_unavailable`, `invalid_output`, `needs_information`, `specialty_unrecognized`, `specialty_not_registered` ou `no_matching_clinics`.
- `clinics`: até três resultados do catálogo; `sources`: trechos textuais associados a seus `clinicId` e, quando aplicável, fontes editoriais de explicação/segurança sem `clinicId`. Essas referências gerais não integram o RAG de clínicas.
- `ragStatus`: `skipped`, `not_indexed`, `available`, `no_matches` ou `unavailable`.
- `locationUsed`: booleano, sem devolver a posição enviada.
- `feedback`: `{token,reasons}` ou `null` quando emissão indisponível. `reasons` contém apenas os motivos aplicáveis àquela resposta.

O LLM retorna `{answer,urgency,specialty:{name,reason}|null,questions}`. O contrato antigo de múltiplas sugestões é rejeitado pelo schema estrito. A aplicação resolve a candidata no banco e publica textos controlados pelo backend; nenhum texto livre do modelo chega à interface. Atualize backend e frontend juntos. `routine` não significa ausência de urgência. Fallbacks de orientação usam HTTP 200 com estado explícito; erros de transporte/banco são HTTP 4xx/5xx.

## Esclarecimento de relato genérico

Quando falta contexto, `status=needs_information`, `specialty=null`, `clinics=[]` e `ragStatus=skipped`. `questions` da resposta pública contém até duas perguntas em PT-BR. Reenvie `context` completo com a próxima resposta; o hook da interface já faz isso.

```json
{
  "specialtyId": null,
  "clinicIds": [],
  "city": "",
  "insurance": "",
  "care": {
    "questions": ["onset_duration", "pattern"],
    "askedTopics": ["onset_duration", "pattern"],
    "round": 1
  }
}
```

`care.questions` e `care.askedTopics` são códigos, não dados clínicos. Aceitam `location`, `onset_duration`, `pattern`, `associated_symptoms`, `trigger`, `impact` e `age_group`. Limites: duas perguntas atuais, sete tópicos distintos possíveis, rodada de 1 a 3. O backend reavalia os textos: adulterar o contexto não autoriza uma recomendação. Os metadados não são persistidos e deixam de acompanhar o contexto após a recomendação.

No **contrato interno do LLM**, `questions` passou a aceitar somente esses códigos. Perguntas livres são rejeitadas; no contrato público continuam sendo textos apresentados pelo backend. Não é necessário mudar o modelo instalado: os adaptadores enviam o schema atualizado em cada chamada. Atualize frontend e backend juntos.

Relatos detalhados com uma candidata válida não são bloqueados por perguntas opcionais ou pela incerteza sobre a causa do sintoma. A urgência `uncertain` é preservada quando retornada pelo modelo; não equivale a um diagnóstico nem é convertida em garantia de segurança. Uma candidata ausente continua impedindo recomendação automática.

Quando a idade pode mudar o encaminhamento, `care.questions` inclui `age_group`. Aceita-se resposta de um caractere, como `5`; o histórico permite vinculá-la à pessoa atendida. A idade do responsável não deve ser aplicada à criança. Uma descrição detalhada pode precisar apenas da idade. Pediatria está ativa pela migração 10.

Queixa no ouvido após introdução de um objeto pontiagudo aciona avaliação presencial no mesmo dia: sem perguntas, clínicas eletivas ou RAG. Pode mostrar a área relacionada Otorrinolaringologia, somente se estiver ativa, sem adiar o atendimento. Emergências detectadas anteriormente continuam tendo prioridade.

## Feedback

```json
{
  "responseId": "UUID retornado pelo chat",
  "token": "token retornado em feedback.token",
  "rating": "negative",
  "reason": "unclear_answer",
  "comment": "A explicação poderia ser mais direta."
}
```

Retorno: `{"status":"saved"}`. `rating` aceita `positive` ou `negative`. Positivo não inclui motivo/comentário; negativo exige um motivo permitido pelo comprovante da resposta. Comentário opcional é trimado, limitado a 500 caracteres e redigido antes de salvar. O token é necessário para impedir votos por IDs arbitrários. Não envie modo, versão do prompt, relato, histórico ou coordenadas: campos extras são rejeitados.

Motivos possíveis: `incorrect_specialty`, `unclear_answer`, `not_helpful`, `clinic_problem`, `location_problem`, `insurance_problem`, `too_slow`, `other`. O mesmo `responseId` atualiza o voto por UPSERT. O comprovante expira em sete dias. Não há endpoint público de listagem.

## Avaliação de visita à clínica

Depois que o chat indica clínicas, o usuário pode avaliar uma delas quando voltar ao app. O fluxo completo está em [FEEDBACK.md](FEEDBACK.md).

```json
{
  "responseId": "UUID retornado pelo chat",
  "token": "token retornado em feedback.token",
  "clinicId": "public-cldo-aldeota",
  "rating": 4,
  "comment": "Atendimento rápido."
}
```

Envie para `POST /visit-feedback`. Retorno: `{"status":"saved"}`.

- `responseId` e `token` são o mesmo comprovante emitido por `POST /chat` (`id` e `feedback.token`). Não existe conta, identificador de usuário nem uso de IP.
- `clinicId` precisa ser uma das clínicas que **aquela resposta** indicou. O servidor guarda essa lista no comprovante (`response_receipts.clinic_ids`) e rejeita qualquer outro ID.
- `rating` é um inteiro de 1 a 5. `comment` é opcional, trimado, limitado a 500 caracteres e redigido por `redactIdentifiers` antes de salvar.
- O par `(responseId, clinicId)` é único: reenviar atualiza a nota e o comentário por UPSERT.
- O comprovante expira em sete dias. Depois disso, a rota responde 400.
- Campos extras, nota fora de 1–5 ou decimal, token incorreto, clínica não indicada e comprovante expirado retornam 400 com `{"error":"Avaliação inválida ou expirada."}`. Dados fora do schema retornam a mensagem padrão de validação.
- Usa o limite `FEEDBACK_RATE_LIMIT`, o mesmo de `/feedback`. Não há endpoint público de listagem.

## Controles HTTP

400: dados/consentimento/comprovante inválidos. 403: origem POST não autorizada. 404: rota ausente. 413: corpo acima de 24 KB. 429: limite de uso. 500: falha interna sem expor conteúdo do erro. Erros usam `{"error":"mensagem"}`.

Limite global: `HTTP_RATE_LIMIT` (padrão 120/minuto/IP). O teste de navegador configura 1000 porque executa dezenas de jornadas usando o mesmo IP; o padrão da aplicação permanece 120. Chat: `CHAT_RATE_LIMIT` (padrão 12); feedback e avaliação de visita: `FEEDBACK_RATE_LIMIT` (padrão 20, contado por rota). Em desenvolvimento, `localhost`, `127.0.0.1` e `[::1]` são aceitos para o mesmo protocolo/porta configurados. Produção exige a origem HTTPS exata. CORS não substitui autenticação ou controle de abuso.
