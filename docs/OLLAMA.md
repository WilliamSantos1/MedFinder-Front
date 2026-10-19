# IA generativa local com Ollama

O MedFinder pode rodar sem chave OpenAI ou API paga. Instale [Ollama](https://ollama.com/download/windows), abra o aplicativo e um novo PowerShell. Na pasta do projeto, execute:

```powershell
node -v
ollama --version
ollama pull qwen3:4b-instruct-2507-q4_K_M
ollama pull bge-m3
npm.cmd ci
npm.cmd run setup:ollama
npm.cmd run dev
```

Abra **http://localhost:5173**. Para os próximos usos, basta deixar o Ollama aberto e executar `npm.cmd run dev`.

`setup:ollama` cria `.env` a partir de `.env.ollama.example` quando necessário. Se a configuração anterior era de outro provedor, preserva um backup privado `.env.backup-*`. Se já era Ollama, mantém seus valores. O padrão usa `DATA_DIR=./.data/ollama`, gerador Qwen3 Instruct e embeddings BGE-M3 de 1024 dimensões.

A preparação aplica migrações, importa as 36 unidades, tenta indexar os 36 resumos públicos e testa a geração com mensagem sintética. O gerador sugere no máximo uma especialidade, validada pela taxonomia; **não precisa do índice RAG para isso**. Falha opcional de embeddings é informada sem bloquear indicação ou catálogo. Depois de resolver o problema, repita a preparação para indexar os documentos.

## Se já tinha a versão anterior

Pare `npm.cmd run dev` com Ctrl+C, faça backup da pasta de dados e atualize o código. Preserve `.env` e `.data`. Execute `npm.cmd ci`, `npm.cmd run db:migrate`, `npm.cmd run setup:ollama` e `npm.cmd run dev`. Não execute manutenção com outro processo usando o mesmo PGlite.

## Conferir funcionamento

```powershell
npm.cmd run setup:check
npm.cmd run integrations:check
```

A primeira verificação examina configuração e banco. A segunda faz um teste sintético real com o gerador e, se houver documentos, testa embeddings. `liveVerified=true` refere-se à geração técnica, não à validade clínica das respostas. O componente textual opcional pode falhar independentemente.

Na interface, deve aparecer **IA local · Ollama**. “Estou com dor no pescoço” agora inicia esclarecimentos; responda às perguntas antes de esperar uma especialidade. Um relato já detalhado pode receber indicação diretamente. Fortaleza + CASSI permite conferir o filtro do catálogo depois da indicação. Também são aceitas consultas diretas, como “Existe clínica de urologia em Fortaleza?” e “Quais clínicas aceitam Unimed?”, sem precisar relatar sintomas. Informações de clínicas vêm do banco e dos textos verificados.

## Localização e feedback

Use “Usar minha localização” se desejar ordenar por proximidade. A posição não é salva nem enviada ao modelo. As 36 unidades distribuídas possuem coordenadas verificadas; a distância é calculada em linha reta. Se todos os cards da instalação antiga continuarem sem distância, pare a API, rode `npm.cmd run catalog:load`, reinicie e autorize localização. Dados demo continuam identificados como exemplos.

Os botões “Sim” e “Não” avaliam a utilidade da resposta e não treinam a IA. O comentário opcional é salvo com redução de identificadores; não inclua dados pessoais ou sintomas.

## Problemas frequentes

| Problema                           | Ação                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `ollama` não reconhecido           | Abrir novo terminal após instalar; conferir instalação                 |
| Modelo ausente                     | Executar `ollama pull` com o nome mostrado no erro                     |
| Geração lenta                      | Aguardar carregamento; o desempenho depende de RAM/CPU/GPU e do modelo |
| BGE-M3 indisponível                | Baixar o modelo e repetir setup; a navegação não depende do RAG        |
| Modelo cloud/alias remoto recusado | Usar pesos locais GGUF; o sistema não envia relatos a modelos cloud    |
| `needsReindex=true`                | Parar API e executar `npm.cmd run rag:reindex`                         |
| Origem não permitida               | Abrir localhost:5173 ou alias de loopback na mesma porta               |

Ollama deve ficar no loopback do servidor MedFinder (`http://127.0.0.1:11434`); redirects e modelos remotos são recusados antes do envio de texto. Não há troca automática para OpenAI. Se mudar o gerador, valide Structured Outputs e comportamento em PT-BR. Trocar modelo/dimensão de embeddings ou atualizar seus pesos exige reindexação. Veja [RAG.md](RAG.md) e [VALIDACAO.md](VALIDACAO.md).
