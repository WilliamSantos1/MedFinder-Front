# Operação e manutenção

## Primeiro uso e portas

`npm ci`, copie `.env.example` para `.env` e execute `npm run dev`. Front: localhost:5173; API: localhost:3001. O Vite encaminha `/api` ao backend. `PORT` diferente de 3001 exige atualizar também o proxy em `vite.config.ts`.

Com `AUTO_SEED=true` e `ALLOW_DEMO_DATA=true`, o processo local aplica migrações, carrega a coleção pública e atualiza os resumos demonstrativos por hash a cada inicialização. Documentos não demonstrativos existentes são preservados. A carga explícita `npm run db:seed` repõe os exemplos pelos mesmos IDs; não use para gerenciar dados reais. `AUTO_SEED=false` desativa a carga automática. Use `catalog:load` para carregar somente as clínicas reais, sem chamadas de IA; `setup:local` carrega também o RAG offline. Consulte [CATALOGO.md](CATALOGO.md). Nenhum comando apaga o banco automaticamente.

Pare a API antes de executar CLI contra o PGlite no mesmo diretório. Para usar API e CLI simultaneamente, configure PostgreSQL externo. Faça backup antes de operações manuais destrutivas.

## Importação de clínicas

Um JSON é uma lista de objetos com os campos de `clinicSchema`, em `shared/contracts.ts`. Exemplo de estrutura fictícia **não publicável**, presente em `data/clinics.demo.json`.

Para um cadastro real, preencha nome, cidade, UF, bairro, endereço, especialidades, convênios, fonte HTTPS, data real de verificação ISO 8601 e `isDemo=false`. Telefone usa formato `+55` + DDD + número, ou `null`. Website e telefone são opcionais. `verifiedAt` não aceita data futura. IDs duplicados fazem o lote ser rejeitado antes da gravação. Cadastros reais vencidos não aparecem no catálogo nem na lista de filtros.

```bash
npm run data:import -- clinics ./dados/clinicas.json
```

A importação é uma transação: um lote inválido não deve ser aplicado parcialmente. É um upsert por `id`; itens ausentes no arquivo não são excluídos. Desative com `active=false` usando o mesmo ID. Mudanças do convênio devem ser revalidadas, principalmente quando existem produtos diferentes da mesma operadora.

## Importação de conhecimento

O JSON segue `documentSchema`. Inclua resumo cujo uso seja autorizado, título, publisher, URL HTTPS da origem, palavras-chave, especialidades e metadados. A clínica responsável deve revisar também as associações de especialidades, alertas e limites de escopo, não apenas a linguagem do resumo.

```bash
npm run data:import -- knowledge ./dados/conhecimento.json
```

Todos os objetos são validados antes do processamento. Cada documento é indexado atomicamente depois de obter seus embeddings; se uma chamada falhar, documentos anteriores do lote podem já ter sido atualizados. Reexecutar é seguro: o hash evita duplicação. Retirar um documento é importar o mesmo ID com `active=false`. Conteúdo inativo sai imediatamente da recuperação.

`reviewedBy` deve identificar o revisor responsável segundo o processo da organização. O software não verifica essa identidade. Não aprove automaticamente a base de demonstração; substitua-a por conteúdo revisado e autorizado. Um cadastro aprovado não pode ser `isDemo=true`.

## Docker

Defina `POSTGRES_PASSWORD` no `.env` antes de `docker compose up --build`. Para testar, mantenha `NODE_ENV=development`, `AI_PROVIDER=demo`, os flags de dados demo e `WEB_ORIGIN=http://localhost:3001`. O Compose cria PostgreSQL/pgvector, aplica as migrações e inicia o app compilado na porta 3001. Use `docker compose logs app` para status operacional (sem adicionar logging de relatos).

```bash
docker compose exec app node build/scripts/manage.js migrate
```

Para importação, copie o JSON para o container ou monte um diretório autorizado e execute `node build/scripts/manage.js import clinics /caminho/clinicas.json`. A imagem inclui scripts compilados; não depende de tsx no runtime. Para reindexar, use `node build/scripts/manage.js reindex`.

## Produção

Use `.env.production.example` com valores reais. A configuração falha ao iniciar caso ainda permita demo, auto-seed, PGlite ou origem HTTP. O código não impõe automaticamente outras condições operacionais ou conformidade legal.

Instale o proxy HTTPS na frente do app. `TRUST_PROXY_HOPS=0` é padrão seguro; só aumente para a quantidade exata de proxies controlados, impedindo acesso direto ao backend por outras rotas. Configure `WEB_ORIGIN` exatamente como a URL que o usuário abre, inclusive porta se houver. CORS não é autenticação; a API de leitura/chat é pública e precisa de proteção contra abuso e limites de gasto no provedor/gateway.

PostgreSQL gerenciado: configure `DATABASE_URL`, use TLS validado com `DATABASE_SSL=true` quando requerido. A aplicação não usa `rejectUnauthorized:false`. Tenha backups testados, monitoramento e usuário do banco apropriado. Para instalação inicial, o banco precisa oferecer a extensão pgvector; em ambientes restritos, peça ao operador que a crie.

`GET /api/health` é liveness. `GET /api/ready` verifica banco e documentos válidos indexados para o modelo configurado. Uma aplicação nova em produção retorna 503 até importar conhecimento aprovado. Isso é esperado; não desligue a verificação para publicar uma base vazia.

## Dados de saúde

Não habilite captura de corpos HTTP em proxy, APM ou logs. A aplicação desabilita logging de requisições e registra apenas categorias de erro, sem SDK error/prompt. Redação de CPF, e-mail e telefone é limitada e não garante anonimização. A OpenAI recebe o relato/contexto após consentimento; configure a conta e o contrato do provedor segundo os requisitos reais do operador. `store:false` não garante retenção zero de todos os sistemas externos.

A ação “Interromper envio” cancela a espera no navegador; uma chamada que já chegou ao provedor pode continuar até seu timeout e gerar custo. Nova conversa remove apenas o estado desta aba, sem prometer exclusão de registros externos.

## Problemas frequentes

| Sintoma                                        | Verificação                                                                        |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| Interface sem conexão                          | API na porta 3001, proxy Vite, `WEB_ORIGIN`, erro de inicialização                 |
| Resposta sem evidências após trocar embeddings | Pare a API local e execute `npm run rag:reindex`                                   |
| Indisponibilidade com chave configurada        | Acesso ao modelo, saldo, quotas, conectividade e timeout                           |
| Clínica não aparece                            | Filtros, `active`, `isDemo`, fonte e `verifiedAt` dentro da janela                 |
| Documento não é recuperado                     | Modelo de embedding, `active`, revisão/idade, vocabulário, pertinência             |
| Erro ao abrir PGlite                           | Diretório gravável, versão do banco e nenhum segundo processo usando a mesma pasta |
| HTTP 429                                       | Limite por IP; aguarde ou ajuste o gateway conforme a demanda real                 |
| Prontidão 503                                  | Migrações, banco e pelo menos um documento elegível com o modelo atual             |

## Ollama local

Consulte [OLLAMA.md](OLLAMA.md). Mantenha o serviço no loopback e use modelos baixados, sem cloud. `setup:ollama` configura o ambiente de desenvolvimento; `integrations:check` testa embeddings e geração locais sem chave. Backups `.env.backup-*` são privados e ignorados pelo Git. A configuração do MedFinder não modifica configurações globais do Ollama. Não há atualização automática das clínicas quando a máquina fica offline.
