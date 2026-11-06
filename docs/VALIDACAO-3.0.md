# Plano de validação MedFinder 3.0

## Camadas automáticas

1. `npm.cmd run check`: lint, typecheck, build e Vitest.
2. `npm.cmd run test:e2e`: Playwright desktop e mobile.
3. `npm.cmd run audit:catalog`: integridade do snapshot.
4. `npm.cmd run benchmark:routing`: latência do roteador local sem banco/RAG/Ollama.
5. `npm.cmd run benchmark:live`: com a API real já em execução, mede resposta end-to-end e confere rotas esperadas.
6. `npm.cmd run setup:ollama`: migrações, catálogo, índice e verificação dos modelos locais.

## O que precisa ser coberto

- 55 rotas diretas da matriz de especialidades;
- casos ambíguos com shortlist;
- rejeição de especialidade retornada fora da shortlist;
- fallback amplo quando LLM falha;
- urgência antes de qualquer IA;
- medicamento/dose/intoxicação;
- troca de paciente no meio da conversa;
- continuidade de respostas curtas;
- filtros de convênio/cidade/especialidade sem relaxamento;
- localização permitida/negada;
- distância apenas com coordenada auditada;
- RAG restrito aos clinic IDs do SQL;
- feedback e feedback pós-visita;
- privacidade do navegador e do payload do modelo.

## Métricas para a apresentação

Além de “testes passaram”, registre:

- **acurácia de navegação top-1/rota aceitável** em uma amostra rotulada;
- **taxa de fallback** para Clínica Médica/Pediatria;
- **recall de alertas** numa bateria de red flags;
- **mediana e p95 de latência**;
- percentual de mensagens resolvidas sem LLM;
- precisão dos filtros (nenhuma clínica fora de especialidade/plano/cidade quando filtrado);
- taxa de respostas úteis no feedback;
- taxa de ausência de clínica após filtros.

## Benchmark honesto

`benchmark:routing` mede somente o roteador determinístico. Ele não mede banco, embeddings ou Ollama. O teste ao vivo deve ser feito separadamente com o mesmo computador da apresentação.

## Validação humana recomendada

Monte uma planilha cega com 50–100 relatos sintéticos e/ou anonimizados, rotulados por alguém da área de saúde quando possível. Compare a rota do sistema com uma rota aceitável definida previamente. Não use o próprio modelo para criar a resposta de referência e julgá-la sozinho.

## Critério de liberação

Não publicar/entregar uma versão se:

- `check` ou E2E falhar;
- uma emergência for desviada para clínica eletiva;
- um filtro puder ser relaxado silenciosamente;
- uma especialidade fora da shortlist puder escapar da validação;
- RAG puder introduzir clínica não selecionada pelo SQL;
- coordenada não verificada puder aparecer como distância.
