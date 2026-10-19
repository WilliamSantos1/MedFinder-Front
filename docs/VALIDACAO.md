# Validação da versão 2.3.1

Validação técnica em 18/10/2026 UTC. Testes usam relatos de exemplo, incluindo a reprodução desidentificada do caso da captura enviada, geolocalização mockada e comentários de teste. A imagem original não foi incluída no repositório.

As duas suítes foram executadas novamente após integrar os commits `c15dc8d` e `9682928`. A configuração Vitest já inclui os plugins React e Tailwind recebidos da equipe. A cobertura de comportamento da versão 2.3 foi preservada.

## Resultado

- `npm run check`: aprovado — lint, typecheck, build e **146 testes** em 12 arquivos.
- `npm run test:e2e`: aprovado — **42 testes**, 21 cenários em desktop e mobile.
- Migrações 1–10, backend, contratos da API e catálogo preservados nesta integração. A migração 10 foi introduzida na versão 2.3.
- Dependências idênticas à versão 2.3; somente a versão do projeto mudou no `package-lock.json`.

## Execução

```bash
npm run check
npm run test:e2e
```

`check` inclui ESLint, TypeScript estrito, build Vite/backend e Vitest. Os testes de banco usam PGlite com pgvector real. A sintaxe de migrations e queries permanece compatível com PostgreSQL; não foi executado nesta entrega um servidor PostgreSQL externo separado.

Playwright exercita Chromium em desktop (1440 × 1080) e viewport móvel. Neste ambiente foi usado um executável Chromium 138 externo via `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, sem alterar a configuração padrão que baixa o navegador suportado pelo Playwright. O viewport móvel não equivale a testar Safari num iPhone físico.

Durante a preparação da versão 2.3, a primeira execução ampliada do navegador encontrou um HTTP 429 ao carregar o catálogo: as jornadas compartilham o mesmo IP e ultrapassavam 120 requisições/minuto. Desde aquela versão, o fixture E2E configura `HTTP_RATE_LIMIT=1000`. O padrão operacional permanece 120; um teste de integração verifica que o limite configurado continua emitindo 429. A execução da versão 2.3.1 passou nos 42 testes sem nova alteração nesses limites.

## Cobertura

- Contrato singular estrito, taxonomia dinâmica, Urologia, resolução de nome/alias, ausência de fuzzy agressivo, cadastro sem rebuild e rejeição de aliases ambíguos.
- “Oculista”, “oftalmo” e “oftalmologista” resolvem para Oftalmologia; regressão do pai de 60 anos com dor no olho. Rótulo inventado é rejeitado e não aparece em resposta, justificativa ou perguntas; texto livre do modelo não é publicado.
- Regressão do questionário excessivo: candidata válida com relato detalhado não é bloqueada por perguntas opcionais ou incerteza sobre diagnóstico. Não se exige duração se já há outros detalhes relevantes. Sem candidata, não se inventa indicação ou uma lista de perguntas adicionais.
- Caso exato da captura: ouvido após uso de lápis gera prioridade presencial, explicação breve e área relacionada ativa, sem perguntas, IA ou clínicas eletivas. Menções negadas ou uso de lápis para desenhar não acionam essa regra.
- Idade da filha separada da idade da mãe; anos, meses, dias de vida, números por extenso, resposta “5” e filha adulta. Não confunde duração de coceira com idade, não repete idade fornecida e não herda idade ao mudar a pessoa. Pediatria não é obrigatória para toda criança.
- Descrições controladas de possibilidades, sem publicar áreas extras ou diagnósticos inventados no texto do modelo. Fontes editoriais de orientação acompanham as fontes do RAG, quando aplicáveis.
- Estado de referência não habilitada separado de especialidade desconhecida e de ausência de clínicas; nenhuma alternativa é apresentada.
- Relatos genéricos de cabeça e pescoço pedem até duas perguntas sem recomendar especialidade ou buscar clínicas, mesmo quando o modelo tenta recomendar prematuramente. Respostas parciais complementam o histórico; detalhes já fornecidos não são perguntados novamente. Um relato inicial detalhado pode seguir diretamente à recomendação.
- Contexto com tópicos de perguntas e limite de três rodadas; esgotar perguntas não força uma especialidade. Nova queixa não herda detalhes do relato anterior. Alertas determinísticos e do modelo interrompem o esclarecimento. Perguntas em texto livre do modelo são rejeitadas pelo contrato interno.
- Medicina de Família e Comunidade desativada no catálogo, filtros, resolução e lista enviada ao modelo. A Clínica FAM mantém suas demais áreas. Consultar a área desativada não resulta numa lista de clínicas sem filtro.
- Consultas diretas por área, proximidade, Unimed e endereço/especialidades da CTI; continuidade por “dessas” e refinamento por convênio; ausência de geração nessas consultas e de embeddings externos sem consentimento.
- Guardrails antes da IA, histórico com alerta, bloqueio de prescrição, diagnóstico explícito, garantia de ausência de risco e dados de clínicas gerados pelo modelo.
- Structured Outputs/OpenAI e Ollama com HTTP simulado; retenção `store:false`, validação de JSON, timeout, proibição de aliases cloud e verificação local antes do envio.
- Filtros exatos e parametrizados de cidade, convênio e especialidade; SQL injection não amplia resultados.
- Haversine, mesmo ponto e distância conhecida, valores inválidos, municípios vizinhos, paginação após ordenação completa, ausência de coordenadas e não persistência da posição.
- RAG limitado a IDs candidatos, hash idempotente, atualização transacional, isolamento por modelo e falha de embedding sem apagar os resultados do catálogo.
- Upgrade de banco da versão 1.3 para migrations 5–8 preserva clínicas, relações e documentos médicos arquivados; reaplicação idempotente.
- Upgrade de 8 para 9 desativa a área solicitada sem apagar unidades ou relações históricas. A migração 10 habilita Pediatria quando ainda não cadastrada, preservando uma desativação explícita feita pelo operador. Reaplicação idempotente.
- Feedback positivo/negativo, motivo contextual, comprimento, redação de identificadores, UPSERT, expiração/token, rate limit e ausência de chamada à IA.
- Navegador: permissão de GPS somente após clique, localização negada sem loop, distância nos cards, estado compartilhado chat/diretório, votos e falha de feedback sem quebrar conversa, rascunho preservado durante falha de resposta, responsividade e ausência de armazenamento local.
- Catálogo: 36 IDs e endereços únicos, fontes HTTPS, procedência, datas, 16 especialidades ativas e correspondência com a auditoria de 36 pares de coordenadas. Distâncias do catálogo real ordenadas em seis páginas; município vizinho permitido sem filtro e cidade exata preservada.
- Tipografia: raiz/corpo/mensagem/input computados em 16px, títulos de cards a partir de 18px, sem overflow horizontal em desktop/mobile e com texto ampliado a 200% no chat, diretório e página explicativa.

## Limites da evidência

Não foi executada inferência real com os pesos Ollama nesta atualização, nem uma chamada paga à OpenAI. Os adaptadores foram validados com transportes simulados. A execução de inferência registrada na documentação da versão anterior usava outro prompt e outro fluxo RAG; não foi reutilizada como prova desta versão. Execute `npm.cmd run integrations:check` no computador com seu Ollama para verificar os modelos instalados.

O catálogo real contém 36 unidades com coordenadas conferidas por endereço/ponto de mapa na preparação dos dados; fontes, método e datas estão em `data/coordinates.provenance.json`. Apenas a Clínica Angellus e seu resumo cadastral foram reconferidos em 18/10/2026 para acrescentar Pediatria. Coordenadas e demais cadastros mantêm suas datas anteriores. Testes exercitam tanto esse catálogo quanto fixtures identificadas, com posição do usuário simulada. Conferência documental não equivale a vistoria, garantia de precisão de entrada do prédio ou disponibilidade do serviço. Os 36 textos públicos são resumos cadastrais de abrangência limitada.

Esses testes demonstram comportamento de software, não sensibilidade, especificidade, acurácia médica ou conformidade regulatória. O reconhecimento de relatos genéricos, de idade e de relação entre pessoas usa heurísticas de linguagem e pode não cobrir toda forma de expressão. Uma candidata validada no vocabulário não prova pertinência clínica. As descrições específicas nesta versão cobrem ouvido e coceira na pele; os demais casos usam uma explicação geral. O feedback mede percepção de utilidade; não torna a orientação clinicamente correta. Guardrails são heurísticos e requerem avaliação independente antes de uso assistencial.
