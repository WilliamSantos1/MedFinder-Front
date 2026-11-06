# Manifesto MedFinder 3.0

Principais mudanças em relação à 2.4:

- novo roteador híbrido `server/domain/specialty-routing.ts`;
- fast-path de queixas claras sem LLM;
- Qwen restrito a shortlist em ambiguidades;
- validação da saída do modelo contra `allowedIds`;
- fallback Clínica Médica/Pediatria para queixas reconhecíveis;
- migração 13 com taxonomia médica atualizada de referência;
- 50 unidades e 50 documentos RAG;
- 34 áreas com cobertura local, 35 planos, 96 vínculos profissionais e 35 coordenadas verificadas;
- expansão das regras de urgência;
- aliases conservadores de convênio;
- auditoria do catálogo;
- benchmark local do roteador;
- nova matriz de cobertura e bateria de regressão;
- E2E adaptado a fast-path, ambiguidade, troca de pessoa, catálogo e segurança.

O RAG continua restrito a clínicas selecionadas pelo SQL. Feedback, follow-up, localização, filtros e privacidade permanecem.
