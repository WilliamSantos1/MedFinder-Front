# API HTTP

Base local: `http://localhost:3001/api`. JSON em UTF-8. A API pública não oferece escrita no catálogo nem recebe credenciais administrativas. Toda manutenção usa CLI.

| Método e caminho | Função                                                                |
| ---------------- | --------------------------------------------------------------------- |
| `GET /health`    | Liveness, `{"status":"ok"}`                                           |
| `GET /ready`     | Banco, catálogo e documentos indexados; 200 ready ou 503              |
| `GET /catalog`   | Filtros, modo, consentimento, estado do RAG e cobertura do catálogo   |
| `GET /clinics`   | Busca paginada; filtros `city`, `insurance`, `specialty`, `q`, `page` |
| `POST /chat`     | Orientação fundamentada, fontes e clínicas filtradas                  |

## POST /chat

```json
{
  "message": "Estou com dor no pescoço",
  "history": [],
  "city": "Fortaleza",
  "insurance": "CASSI",
  "consent": false
}
```

`message`: 3–2000 caracteres depois de trim. `history`: até 6 relatos anteriores, no máximo 2000 caracteres cada, apenas strings de mensagens do usuário. Filtros: até 80 caracteres. `consent=true` é obrigatório para envio à OpenAI; uma resposta determinística de urgência pode ser produzida sem essa autorização. Campos desconhecidos são rejeitados.

Formato de resposta:

```typescript
interface ChatResponse {
  id: string;
  answer: string;
  urgency: 'emergency' | 'prompt' | 'routine' | 'uncertain';
  specialtyIds: Specialty[];
  questions: string[];
  sources: Array<{
    id: string;
    title: string;
    url: string;
    publisher: string;
    excerpt: string;
    reviewStatus: 'draft' | 'approved';
  }>;
  clinics: Clinic[];
  mode: 'demo' | 'openai' | 'ollama' | 'safety' | 'fallback';
  notice: string;
}
```

Os tipos completos, campos do cadastro e validações estão em `shared/contracts.ts`. `routine` é uma categoria de navegação, não uma confirmação de ausência de urgência. `fallback` também usa HTTP 200 porque contém uma resposta utilizável de incerteza/indisponibilidade; o consumidor deve inspecionar `mode`.

## GET /clinics

Exemplo: `/api/clinics?city=Fortaleza&insurance=CASSI&specialty=ortopedia&page=1`.

```json
{ "items": [], "total": 0, "page": 1, "pageSize": 6 }
```

Resultado vazio é válido. A busca não relaxa convênio/cidade silenciosamente e não acrescenta dados externos. `total` conta todos os resultados; `items` contém no máximo seis. Ordenação alfabética, primeiro os cadastros reais. `specialty` aceita IDs da taxonomia; `page` vai de 1 a 1000. `q` é opcional, tem até 100 caracteres e procura todas as palavras no nome, bairro e endereço, ignorando acentos e caixa. Não relaxa os outros filtros.

## Erros e limites

Erros de transporte usam `{"error":"mensagem"}`. 400 para entrada/consentimento inválidos, 403 para origem de POST divergente, 404 para rota ausente, 413 para corpo maior que 24 KB, 429 para limite de uso e 500 para falhas inesperadas. Respostas da API têm `Cache-Control: no-store`.

Por padrão: 120 requisições/minuto por IP; chat 12/minuto. Até quatro solicitações de IA simultâneas por processo. O limite de chat é configurável por `CHAT_RATE_LIMIT`; concorrência por `AI_MAX_CONCURRENCY`. Em saturação de IA o chat retorna `mode=fallback`. CORS restringe a origem permitida pelo navegador, mas não impede clientes diretos: proteja a aplicação pública com limites de infraestrutura e de gastos.

## Estado do catálogo e do RAG (v1.2)

`GET /api/catalog` inclui `knowledge: { indexedDocuments, demoDocuments, needsReindex }` e `directory: { total, realRecords, sourceCount, lastVerifiedAt }`. `sourceCount` conta domínios distintos das fontes reais visíveis; `lastVerifiedAt` é a data mais recente declarada nesses registros, não uma consulta automática às fontes. `demoData` descreve clínicas fictícias visíveis. Nenhum desses campos contém chaves ou relatos.

`GET /api/ready` retorna 503 com `reindex_required`, `knowledge_unavailable` ou `catalog_unavailable`. Não faz chamadas pagas nem prova disponibilidade externa; use `integrations:check` para testar o provedor de IA selecionado.

Clínicas podem ter `state=null`, `neighborhood=null` e `insurances=[]` quando a fonte não informou. `provenance` aceita `official-website`, `public-directory` e `manual`. O formato antigo com `integration` foi retirado: registros legados da API são desativados pela migração e não são retornados. `professionalName` continua opcional para importações com vínculo documentado a um profissional.

No modo `ollama`, `requiresConsent=false` porque o texto é processado no servidor local. `mode=ollama` distingue a resposta generativa local do modo `demo`. `chatTimeoutMs` informa a espera máxima recomendada ao cliente: 60000 ms nos modos anteriores; duas vezes `OLLAMA_TIMEOUT_MS` mais 30000 ms no modo local. O endpoint de prontidão não verifica se o Ollama está aberto.
