# Release notes — 3.0.0

## Mudança principal

O MedFinder deixa de depender de uma única chamada generativa para toda navegação e passa a usar um **motor híbrido**. Queixas de alta confiança são resolvidas localmente; ambiguidades usam Qwen com shortlist; falhas usam fallback amplo; segurança e catálogo direto são independentes do LLM.

## Correções de regressões observadas

- queixa ocular simples não termina mais em “não consegui validar”;
- resposta curta a perguntas mantém o contexto correto;
- nova pessoa não herda especialidade anterior;
- “tem certeza?” não repete inferência/RAG/cards;
- pedido de Rivotril/medicação não herda Oftalmologia ou outra área;
- possível excesso de medicamento aciona orientação de intoxicação;
- “Clínica Unimed” não é confundida com filtro de convênio Unimed;
- palavras corporais isoladas não forçam especialidade específica em contexto ambíguo;
- saída do Qwen fora da shortlist é rejeitada.

## Dados

Snapshot ampliado para 50 unidades e 50 documentos RAG; 34 áreas possuem cobertura local, com 35 nomes de plano, 96 vínculos profissional–unidade e 35 unidades georreferenciadas.

## Validação

Veja [VALIDACAO-3.0.md](VALIDACAO-3.0.md) e [VALIDACAO-ARTEFATO.md](VALIDACAO-ARTEFATO.md).
