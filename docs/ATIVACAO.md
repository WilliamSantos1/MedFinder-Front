# API OpenAI opcional

Para uso sem API paga, utilize [Ollama local](OLLAMA.md). As instruções abaixo são apenas para quem optar pelo provedor externo.

Pare a aplicação. O arquivo `.env.connected.example` está na raiz, junto de `package.json`. Se ainda não tiver `.env`, copie-o:

```powershell
Copy-Item .env.connected.example .env
```

Se já tiver configuração, edite apenas os campos necessários:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=sua-chave-apenas-no-servidor
OPENAI_MODEL=gpt-4.1-mini
EMBEDDING_MODEL=text-embedding-3-small
```

Depois execute:

```powershell
npm.cmd ci
npm.cmd run setup:connected
npm.cmd run integrations:check
npm.cmd run dev
```

A conta/chave precisa ter acesso aos modelos, quota e saldo da API. A assinatura do ChatGPT não configura essa integração. Nunca inclua chave em `VITE_*`, Git ou frontend. Ao enviar relatos à OpenAI, a interface solicita autorização; a emergência determinística pode ser respondida sem envio externo.

`setup:connected` aplica migrações, importa as 36 unidades do catálogo público e tenta indexar seus 36 resumos verificados. Não importa resumos médicos antigos. A geração sugere uma única especialidade ou nenhuma; a aplicação resolve nomes/aliases e filtra clínicas no banco. O RAG é opcional e atua somente após os filtros. Consultas diretas ao catálogo dispensam geração e funcionam sem consentimento; nesse caso, embeddings externos também não são chamados.

`setup:check` não faz chamadas externas. `integrations:check` testa geração e, quando aplicável, embeddings com entrada sintética; essas chamadas podem gerar cobrança. `liveVerified` comprova apenas resposta técnica do gerador, não acurácia médica, cobertura do convênio ou prontidão clínica.

O adaptador usa Responses API, Structured Outputs e `store:false`. Relato/histórico recente são enviados após redução limitada de identificadores; localização e feedback nunca vão à IA. A política do provedor permanece aplicável: `store:false` não equivale a retenção zero em todos os sistemas externos.

Veja [OPERACAO.md](OPERACAO.md) para produção, importação e limites; [VALIDACAO.md](VALIDACAO.md) descreve o que foi efetivamente testado nesta versão.
