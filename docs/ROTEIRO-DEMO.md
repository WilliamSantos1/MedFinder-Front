# Roteiro de demonstração — 8 a 10 minutos

## 1. Problema (40 s)

“Eu sei o que estou sentindo, mas não sei qual especialista procurar nem qual clínica perto de mim atende meu plano.”

## 2. Caso rápido sem LLM (1 min)

Digite: `bom dia, meu olho está avermelhado e coçando`.

Explique que o roteador reconhece uma associação forte com Oftalmologia e evita gastar tempo chamando o LLM. Mostre clínicas e fontes.

Digite: `tem certeza?`.

Mostre que confirma a rota sem refazer RAG/cards.

## 3. Troca de pessoa (45 s)

Digite: `meu filho de 8 anos está com coriza desde ontem`.

Mostre Pediatria e destaque que a nova pessoa não herdou Oftalmologia.

## 4. Ambiguidade real (1 min)

Nova conversa: `estou com tontura`.

Explique que não existe palavra-chave segura única: Neurologia e Otorrinolaringologia podem ser candidatas; o Qwen recebe shortlist e sua saída é validada.

## 5. Segurança (1 min)

Nova conversa: `vou tomar Rivotril, pode ser?`.

Mostre que o sistema não prescreve.

Depois: `tomei muitos comprimidos por engano`.

Mostre Disque-Intoxicação. Não execute o fluxo de clínicas.

## 6. Emergência (45 s)

Nova conversa: `dor no peito e falta de ar`.

Mostre SAMU 192 e ausência de catálogo eletivo.

## 7. Catálogo, plano e localização (1–2 min)

Ative localização. Pergunte: `quais clínicas aceitam Unimed?` ou escolha especialidade/filtros no catálogo.

Explique:

- filtros são exatos;
- distância só existe para coordenadas verificadas;
- sem resultado o sistema não troca convênio/especialidade silenciosamente.

## 8. RAG e fontes (1 min)

Abra as fontes de um resultado. Explique que o RAG só pesquisa os clinic IDs já filtrados pelo SQL; não escolhe especialidade.

## 9. Feedback e engenharia (1 min)

Dê feedback e mostre a avaliação posterior. Em seguida mostre no terminal:

```powershell
npm.cmd run check
npm.cmd run test:e2e
npm.cmd run audit:catalog
npm.cmd run audit:routing
npm.cmd run benchmark:routing
npm.cmd run benchmark:live
```

Finalize com a arquitetura híbrida e as limitações explícitas.
