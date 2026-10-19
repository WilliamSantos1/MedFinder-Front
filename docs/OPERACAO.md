# Operação e manutenção

## Instalar e atualizar

Use Node.js >=22.16. No PowerShell, prefira `npm.cmd` para não depender da execução de scripts `.ps1`. Execute comandos na pasta de `package.json`.

```powershell
npm.cmd ci
npm.cmd run db:migrate
npm.cmd run setup:ollama
npm.cmd run dev
```

Ollama deve estar aberto com o gerador configurado já baixado. `bge-m3` é usado no RAG opcional. Portas: frontend 5173, API 3001, Ollama 11434. Preserve `.env` existente. Antes de atualizar, pare a API e faça backup do diretório de dados configurado (`.data/ollama` ou `.data/postgres`). Não execute dois processos sobre o mesmo PGlite.

Migrações 5–7 criaram taxonomia, textos de clínicas, coordenadas e feedback; a migração 8 acrescenta aliases explícitos a 9 desativa Medicina de Família e Comunidade e a 10 habilita Pediatria. As anteriores são preservadas. Não apague o banco para aplicar a nova versão. Sem PostgreSQL externo, a CLI e a API precisam usar o mesmo `DATA_DIR`. Em produção, aplique `db:migrate` antes de subir a API; ela não migra automaticamente.

`AUTO_SEED=true` é para desenvolvimento. Carrega a coleção pública; no modo demo indexa os textos públicos via hashing offline. O modo generativo usa setup explícito. `catalog:load` apenas importa o snapshot versionado, sem visitar sites ou renovar verificação. Cadastros manuais fora da coleção permanecem; exemplos demo e itens removidos da coleção são desativados. Coordenadas administrativas são preservadas quando ausentes no snapshot ou quando sua verificação é mais recente.

Relatos genéricos agora pedem esclarecimentos. Para testar, envie “estou com dor de cabeça” e responda às perguntas. São até duas por resposta, sem repetir tópicos já respondidos. Não altere o prompt para forçar indicação quando faltar contexto. O modelo pode manter incerteza mesmo após os esclarecimentos.

## Taxonomia administrativa

Exemplo de arquivo `especialidades.json`:

```json
[{ "id": "pediatria", "name": "Pediatria", "aliases": ["Pediatra"], "active": true }]
```

```powershell
npm.cmd run data:import -- specialties caminho/especialidades.json
```

O comando atualiza cadastro e referência, normaliza nomes/aliases e rejeita ambiguidades. Não exige rebuild nem reiniciar o backend; recarregue a interface para buscar o novo catálogo. O administrador precisa verificar a nomenclatura. Não use o importador para registrar rótulos inventados pelo modelo. `active=false` retira a especialidade dos filtros e da resolução ativa, preservando seus vínculos.

## Clínicas e coordenadas

Importe uma lista no formato de `clinicSchema`; exemplo fictício em `data/clinics.demo.json`. Campos reais exigem fonte HTTPS e `verifiedAt` não futura; cadastros ficam ocultos após 180 dias sem reverificação. Convênios desconhecidos são `[]`; telefone/website desconhecidos são `null`. Importar não cria especialidades automaticamente.

```powershell
npm.cmd run data:import -- clinics caminho/clinicas.json
```

A importação é transacional por lote, com UPSERT por ID. Itens ausentes não são removidos; use `active=false` para retirar. Reserve `public-` para a coleção distribuída. Fonte/contato/cobertura precisam ser revalidados pelo operador.

`latitude` e `longitude` são nullable e devem ser preenchidas em par. Para clínicas reais, coordenadas exigem `coordinatesVerifiedAt` e `coordinatesSourceUrl` próprios. Geocodifique/verifique administrativamente e então importe. Não há chamada a geocoder durante consultas. O catálogo 2.3 inclui 36 unidades com pares verificados; `data/coordinates.provenance.json` registra o ponto/endereço encontrado, a fonte e o método. Não reutilize o ponto da matriz em outras filiais. As coordenadas demo servem apenas a testes.

Se a instalação antiga ainda mostrar distância indisponível para todo o catálogo, pare a API e rode `npm.cmd run catalog:load` usando o mesmo `.env`/`DATA_DIR`. Reinicie e autorize “Usar minha localização”. Apenas migrar o schema não preenche os registros antigos: é necessário importar o snapshot atualizado. `setup:ollama` já faz essa importação e tenta indexar os 36 textos públicos.

## Documentos de clínicas

```powershell
npm.cmd run data:import -- clinic-documents caminho/textos.json
npm.cmd run rag:reindex
```

Campos: `id`, `clinicId`, `title`, `content`, `sourceUrl`, `verifiedAt`, `isDemo`, `active`. Veja [RAG.md](RAG.md). Não use mais `data:import -- knowledge`. A importação não transforma documentos antigos de orientação médica em descrições de clínicas.

Hash evita trabalho repetido. O recálculo de embeddings acontece antes da substituição transacional por documento; o lote inteiro não é atômico. Para retirar documento, importe com `active=false`. Não atribua serviços, público ou estrutura sem fonte; datas não são renovadas automaticamente. O CLI não verifica o conteúdo remoto ou a identidade do operador: proteja o acesso ao ambiente/banco.

## Feedback e retenção

`ai_feedback` guarda uma linha por resposta, atualizável. Não contém relato, histórico, resposta completa ou localização. Comentários são opcionais, limitados e redigidos; podem ainda conter informação que o usuário decidiu incluir. Não habilite logs de corpo em API, proxy ou APM.

`response_receipts` guarda apenas o hash do token e metadados de autorização; expira em 7 dias. Execute periodicamente no ambiente autorizado:

```powershell
npm.cmd run feedback:prune
```

A limpeza não apaga as avaliações existentes. Defina a retenção administrativa do feedback para o projeto. Análises devem considerar que se trata de utilidade percebida, não avaliação de acurácia clínica. Não existe endpoint público de leitura ou treinamento automático.

## Produção e Docker

`.env.production.example` exige PostgreSQL externo + pgvector, provedor generativo, origem HTTPS, `ALLOW_DEMO_DATA=false` e `AUTO_SEED=false`. `npm run build` gera `dist/` e `build/`; `npm start` serve API e frontend na mesma origem. `/api/health` indica processo ativo; `/api/ready` verifica banco, taxonomia e catálogo visível, sem exigir índice textual ou validar conectividade real da IA.

No Compose de desenvolvimento, defina `POSTGRES_PASSWORD` e `WEB_ORIGIN=http://localhost:3001`, execute `docker compose up --build` e abra a porta 3001. Ollama limitado a loopback precisa estar acessível no mesmo ambiente de rede do processo; o exemplo Compose não fornece um serviço Ollama. Comandos na imagem compilada usam `node build/scripts/manage.js migrate`, `import`, `reindex` ou `feedback-prune`.

Use TLS validado em PostgreSQL quando aplicável e backup restaurável. Configure `TRUST_PROXY_HOPS` apenas para proxies controlados; CORS não autentica clientes. Rate limits atuais são por processo, então réplicas precisam de limite compartilhado no gateway. Não registre prompts, sintomas, feedback, coordenadas ou chaves.

## Diagnóstico rápido

| Sintoma                       | Verificar                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| “Origem não permitida”        | Abrir o endereço/porta de `WEB_ORIGIN`; aliases de loopback somente no desenvolvimento                              |
| `llm_unavailable`             | Ollama aberto/modelo baixado; ou credenciais/quota/conexão OpenAI                                                   |
| `invalid_output`              | Saída fora do contrato ou bloqueada por guardrails; não relaxar as regras para exibir a resposta                    |
| Especialidade não reconhecida | Nome/alias exato; cadastrar somente após validação administrativa                                                   |
| Sem clínicas                  | Especialidade ativa, cidade/convênio exatos, atividade e verificação do cadastro                                    |
| Distância indisponível        | Recarregar o catálogo 2.3 no banco correto; conferir permissão e pares/fonte/data da unidade; não inferir distância |
| Localização negada            | Permissão do navegador; sem loop de solicitação, cidade continua funcionando                                        |
| RAG indisponível              | Modelo de embeddings, dimensão, documentos e data; chat/catálogo continuam independentes                            |
| Feedback não salvo            | Token/ID da resposta, motivo contextual, prazo de 7 dias, limite ou conexão                                         |
| PGlite em uso                 | Parar a API antes de CLI; usar PostgreSQL externo para concorrência                                                 |
| HTTP 429                      | Aguardar janela; revisar limites para a demanda real                                                                |

“Interromper envio” interrompe a espera do navegador; uma chamada já enviada ao provedor pode continuar até o timeout. Nova conversa limpa o estado da aba, sem prometer remoção de registros externos do provedor. Antes de uso assistencial, é necessária avaliação clínica independente da navegação e das regras.
