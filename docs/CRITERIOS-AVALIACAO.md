# Como a versão 3.0 atende aos critérios da disciplina

## Engajamento e participação — 2 pontos

Evidências sugeridas:

- histórico de evolução no Git/GitHub;
- regressões descobertas em uso real e transformadas em testes;
- feedback do usuário final dentro do próprio sistema;
- documentação de decisões e limitações;
- validação externa planejada com relatos rotulados.

## Evolução do projeto — 4 pontos

A versão 3.0 demonstra evolução técnica concreta:

1. catálogo/filtering inicial;
2. IA local + embeddings/RAG;
3. taxonomia canônica e segurança;
4. localização e feedback;
5. roteador híbrido que reduz dependência do LLM;
6. shortlist semântica e validação `allowedIds`;
7. fallback universal de navegação;
8. catálogo/profissionais ampliados;
9. scripts de auditoria e benchmark;
10. testes de regressão a partir de falhas reais.

## Escopo e aplicabilidade — 2 pontos

O problema é objetivo e demonstrável: transformar uma queixa em uma rota de especialidade e então localizar clínicas privadas compatíveis com filtros reais. O sistema mantém cidade, convênio, localização opcional, fontes, contato, profissionais publicados e feedback.

## Complexidade técnica — 2 pontos

Mostre no diagrama e no código:

- React/TypeScript/Vite;
- Fastify;
- PGlite/PostgreSQL;
- pgvector;
- Ollama/Qwen;
- embeddings `bge-m3`;
- RAG restrito ao SQL;
- roteamento determinístico ponderado;
- guardrails;
- migrações;
- Haversine;
- rate limiting;
- schemas Zod;
- testes Vitest e Playwright;
- auditoria de dados e benchmark.

## Estratégia para maximizar a demonstração

Não gaste a apresentação inteira em slides. Mostre uma sequência curta de casos que evidencie cada camada da arquitetura e termine com a suíte de testes/auditoria. O [ROTEIRO-DEMO.md](ROTEIRO-DEMO.md) já organiza essa sequência.
