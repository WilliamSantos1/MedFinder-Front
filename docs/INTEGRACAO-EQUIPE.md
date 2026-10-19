# Integração da equipe — versão 2.3.1

Integração em 18/10/2026 dos dois commits de `origin/main` com a versão local 2.3 (`ca74b99`). O ancestral comum é `0f3f8aa`. O merge preserva os commits originais e as evoluções locais, sem reescrever o histórico.

| Commit                                                                                                         | Alterações recebidas                                                                                   |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`c15dc8d`](https://github.com/WilliamSantos1/MedFinder-Front/commit/c15dc8d561ebda1f050299b5e790564f52c336cd) | Tamanhos de fonte em `rem`, remoção de textos e selos redundantes, plugins React e Tailwind no Vitest. |
| [`9682928`](https://github.com/WilliamSantos1/MedFinder-Front/commit/9682928a5dae883d02968ec1de64456b21d3eeda) | Remoção do import `Sparkles` que ficou sem uso no painel de chat.                                      |

Esses commits modificam quatro arquivos: `src/App.css`, `src/App.tsx`, `src/features/chat/ChatPanel.tsx` e `vitest.config.ts`. A configuração de testes também foi integrada. Não há mudanças em `server/`, contratos da API, dados ou migrações nesses dois commits.

## Resolução do conflito

- A versão 2.3 já havia aumentado as fontes usando variáveis em `rem`. Mantivemos os tamanhos maiores em cada ponto, incluindo corpo, resposta e campo de mensagem em 16px na configuração padrão do navegador. O texto acima do título da página passou de 14px para 16px no desktop, incorporando o aumento restante. No mobile continua em 14px.
- Foram retirados o texto “Seu relato merece cuidado”, a legenda de versão no menu, o selo “Sem cadastro” do cabeçalho e “SEU GUIA DE CUIDADO” do painel. Os demais avisos e controles permanecem. As regras CSS exclusivas desses elementos também foram removidas.
- Tailwind continua importado uma única vez, em `src/index.css`; não foi duplicado em `src/App.css`.
- Os plugins React e Tailwind foram acrescentados ao Vitest mantendo os padrões, limites de tempo e execução sequencial dos testes existentes. As dependências já estavam declaradas: não houve atualização de pacotes.
- Foram preservados os ajustes da versão 2.3: perguntas somente quando falta contexto relevante, idade da pessoa com os sintomas, explicação breve, validação de uma única especialidade, prioridade de urgência, catálogo, proximidade e RAG.

## Atualizar a versão 2.3 já instalada

Pare o projeto e faça um backup. Substitua os arquivos de código pelo conteúdo da pasta `MedFinder` do ZIP, preservando `.env`, `.data` e `.git`. Execute na pasta que contém `package.json`:

```powershell
npm.cmd ci
npm.cmd run dev
```

Mantenha o Ollama aberto e acesse `http://localhost:5173`. Esta integração não altera modelos, prompts, banco ou catálogo; não precisa baixar modelos nem reindexar novamente se a versão 2.3 já estava configurada. Para atualizar uma versão mais antiga, siga [ENTREGA.md](ENTREGA.md).

O ZIP contém o código completo e não inclui a pasta `.git` nem os dados locais. A integração e o commit foram preparados localmente; este documento não confirma publicação no GitHub. A validação executada está em [VALIDACAO.md](VALIDACAO.md).
