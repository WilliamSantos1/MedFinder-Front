# Validação executada no artefato gerado

Esta página registra somente o que foi realmente executado no ambiente de geração.

## Passou

- checagem sintática Node/TypeScript dos arquivos `.ts` de backend, scripts, contratos e testes: **67 arquivos**;
- matriz de roteamento direto: **55/55 casos** com a especialidade esperada;
- corpus adicional de regressão em linguagem natural: **65/65 casos** (determinísticos, ambiguidades, esclarecimento e fallback);
- regressão específica: `bom dia, meu olho esta avermelhado e coçando.` → `oftalmologia` por fast-path;
- continuidade: `estou com dor` + `no pescoço e piora quando viro` → `ortopedia` usando histórico;
- troca de pessoa: queixa ocular anterior + `meu filho de 8 anos está com coriza` → escopo novo e `pediatria`;
- idade do cuidador não é aplicada à filha quando a idade dela continua desconhecida;
- integridade JSON do catálogo/RAG;
- 50 clínicas, 50 documentos RAG, 34 áreas cobertas, 35 planos, 96 vínculos de profissionais, 85 profissionais únicos e 35 coordenadas verificadas;
- 39 URLs-fonte distintas em 38 domínios;
- benchmark puro do roteador: 5.000 avaliações em ~544,35 ms, média ~0,1089 ms por avaliação neste ambiente (ordem de décimos de milissegundo; varia com a máquina).

## Não foi possível executar aqui

`npm ci` não concluiu porque a instalação dependeu de pacote não presente no cache e a rede do ambiente de geração expirou. Por isso **não há alegação de Vitest/Playwright verdes neste artefato**.

Na sua máquina, execute obrigatoriamente:

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd run test:e2e
npm.cmd run audit:catalog
npm.cmd run benchmark:routing
npm.cmd run setup:ollama
```

A versão só deve ser considerada liberada para apresentação após essas etapas passarem no ambiente real.
