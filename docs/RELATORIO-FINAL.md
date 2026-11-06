# Relatório final — MedFinder 3.0

## 1. Problema e proposta

Pessoas frequentemente sabem descrever um desconforto, mas não sabem qual especialidade procurar nem quais clínicas privadas próximas atendem seu plano. O MedFinder reduz essa fricção em duas etapas: **navegação de cuidado** e **busca operacional de atendimento**.

O produto não tenta diagnosticar. A decisão útil é: “qual área procurar?”; depois: “quais unidades compatíveis existem no meu contexto?”.

## 2. Evolução do projeto

A evolução técnica pode ser demonstrada por versões:

- catálogo e filtros básicos;
- IA local e RAG;
- especialidade canônica e segurança;
- Pediatria/continuidade/feedback/localização;
- versão 3.0 com roteador híbrido, taxonomia ampla, LLM restrito a ambiguidades, fallback universal de navegação, dados ampliados e auditoria.

Falhas reais encontradas durante testes — por exemplo, uma queixa ocular que caiu em informação limitada, herança indevida de especialidade entre pessoas e pedido de medicamento que reutilizava contexto anterior — foram convertidas em regras arquiteturais e testes de regressão.

## 3. Escopo e aplicabilidade

O MVP é voltado a clínicas/consultórios privados no Ceará, com foco operacional em Fortaleza e municípios próximos do snapshot. A experiência combina:

- texto livre;
- especialidade sugerida sem diagnóstico;
- cidade;
- convênio;
- localização opcional;
- clínicas e fontes;
- profissionais quando documentados;
- feedback.

O sistema continua útil mesmo se a IA generativa estiver indisponível: fast-path, segurança, catálogo e fallback amplo são independentes do Qwen.

## 4. Complexidade técnica

- React + TypeScript + Vite;
- Fastify + validação Zod;
- PGlite/PostgreSQL e migrações;
- pgvector + embeddings `bge-m3`;
- Qwen3 1.7B local no Ollama;
- roteador ponderado de linguagem natural;
- shortlist semântica e validação canônica;
- SQL de filtros exatos;
- Haversine e privacidade de geolocalização;
- RAG restrito ao resultado do SQL;
- guardrails de urgência/medicação/intoxicação;
- rate limiting;
- feedback e follow-up;
- testes Vitest e Playwright;
- scripts de auditoria e benchmark.

## 5. Decisões de engenharia relevantes

### Não usar LLM para tudo

Casos comuns são resolvidos localmente, melhorando velocidade e previsibilidade. O LLM só participa quando o ganho semântico justifica o custo.

### Não usar RAG para escolher especialidade

O RAG contém textos de clínicas, portanto só é chamado depois de especialidade e filtros. Isso impede que um texto de clínica “puxe” o usuário para uma área errada.

### Não forçar precisão falsa

Queixa reconhecível porém ambígua recebe Clínica Médica/Pediatria se a resolução semântica falhar. É melhor uma porta de entrada ampla do que uma especialidade específica inventada.

### Não inventar catálogo

Sem fonte, não há convênio, coordenada, CRM/RQE ou profissional “preenchido por IA”.

## 6. Resultados estruturais da versão

Snapshot: 50 unidades, 50 documentos RAG, 34 áreas com clínica, 35 planos, 96 vínculos profissionais, 85 nomes únicos e 35 unidades georreferenciadas. A matriz automática cobre 54 especialidades médicas ativas do projeto e Psicologia como área de cuidado separada; Medicina de Família e Comunidade permanece inativa por decisão de escopo.

## 7. Segurança e ética

O MedFinder não diagnostica, não prescreve e não garante ausência de urgência. Red flags são processadas antes do LLM. Pedidos de automedicação recebem limite explícito. Possível intoxicação aponta para o serviço oficial apropriado. Dados de localização são temporários.

## 8. Limitações

- snapshot de clínicas não é diretório completo e pode desatualizar;
- disponibilidade/agendamento não é tempo real;
- heurísticas de navegação precisam de validação humana externa;
- modelo local pequeno pode errar ambiguidades, mitigadas por shortlist/fallback;
- localização é distância em linha reta, não tempo de deslocamento;
- Odontologia e outras profissões fora da taxonomia médica não são tratadas como especialidade médica.

## 9. Como defender na apresentação

Demonstre não só o “chat funcionando”, mas as decisões arquiteturais: um caso fast-path, um ambíguo, uma emergência, um pedido de medicamento, busca por plano/localização, RAG restrito e feedback. Depois mostre testes, auditoria do catálogo e benchmark.
