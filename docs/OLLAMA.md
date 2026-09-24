# IA generativa local, sem pagar por uma API

O MedFinder 1.3 pode gerar respostas e calcular embeddings no seu computador com **Ollama**. Não exige chave da OpenAI, cartão, assinatura do ChatGPT ou API de clínicas. Os modelos são baixados uma vez; depois, chat, busca RAG e catálogo funcionam localmente. Abrir o site de uma clínica ou uma fonte externa ainda exige internet.

## Instalação no Windows

### 1. Instalar o Ollama

Baixe e instale pelo [site oficial](https://ollama.com/download/windows). Abra o Ollama e deixe-o em execução. Feche e abra novamente o PowerShell após instalar, para reconhecer o comando `ollama`.

### 2. Baixar os dois modelos

No PowerShell, execute um comando por vez e espere terminar:

```powershell
ollama pull qwen3:4b-instruct-2507-q4_K_M
ollama pull bge-m3
```

`qwen3:4b-instruct-2507-q4_K_M` escreve as respostas em português. `bge-m3` transforma o relato e os documentos em vetores para a busca do RAG. Ambos são modelos locais; não escolha versões com `cloud` no nome. Não é preciso fazer login no Ollama para esses downloads públicos.

Os arquivos dos modelos somam aproximadamente **3,7 GB**, além do próprio Ollama e do projeto. Para começar com folga, recomendamos **16 GB de RAM e 15 GB livres no disco**; isso é uma estimativa para este conjunto, não uma garantia de desempenho. É possível usar CPU, mas as respostas podem levar mais tempo. Uma GPU compatível ajuda. Não há cobrança por mensagem; o processamento usa memória, energia e hardware do seu PC.

### 3. Preparar o MedFinder

Extraia a nova entrega em uma pasta separada, preservando sua instalação anterior. Entre na pasta **MedFinder**, a que contém `package.json`. Clique na barra de endereço do Explorador, digite `powershell` e pressione Enter.

Execute:

```powershell
npm.cmd ci
npm.cmd run setup:ollama
```

Se já executou `npm.cmd ci` nesta nova versão, não precisa repetir. `setup:ollama`:

1. Cria o `.env` automaticamente a partir de `.env.ollama.example`. Você **não precisa procurar, copiar ou editar esse arquivo**.
2. Se existir uma configuração local de outro modo, guarda uma cópia `.env.backup-...` antes de ativar Ollama. Não sobrescreve uma configuração Ollama já existente nem converte automaticamente uma configuração de produção/banco externo.
3. Confere se os dois modelos estão instalados localmente, cria o banco em `.data/ollama`, indexa os oito resumos e carrega as 20 clínicas reais.
4. Faz um teste técnico de embeddings e geração. Ao terminar com sucesso, imprime **“IA local pronta”**. A primeira execução pode demorar alguns minutos.

Não rode esse comando enquanto outra instância do MedFinder estiver usando o mesmo banco. O banco antigo e seus arquivos não são apagados. A configuração anterior pode conter uma chave: mantenha os backups privados e fora do Git, assim como o `.env`.

### 4. Abrir o aplicativo

```powershell
npm.cmd run dev
```

Abra **http://localhost:5173**. O cabeçalho do chat deve mostrar **“IA local · Ollama”**. Uma resposta gerada e validada terá `mode=ollama` e fontes consultáveis. O modo `fallback` significa que a consulta não produziu orientação suficiente, e não comprova sucesso da geração.

Nas próximas vezes, abra o Ollama e execute apenas `npm.cmd run dev`. Não precisa baixar os modelos nem preparar o banco novamente.

## Por que ainda aparece “demonstração”?

A IA local é generativa de verdade. O aviso se refere aos **resumos médicos de homologação**, que ainda não foram revisados por um profissional. As 20 clínicas são registros reais com fontes documentadas, mas o catálogo é uma cópia local, sem atualização automática de horários, preços ou cobertura. A revisão clínica continua necessária antes de disponibilizar orientação a pacientes.

## Resolver problemas

| Mensagem ou situação               | O que fazer                                                                                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `ollama` não reconhecido           | Instale o Ollama e reabra o PowerShell.                                                                                                         |
| Ollama indisponível                | Abra o aplicativo Ollama; confirme que ele está em execução. Depois repita `npm.cmd run setup:ollama`.                                          |
| Modelo local ausente               | Execute o `ollama pull ...` indicado no erro. `ollama list` mostra os modelos baixados.                                                         |
| Falta de memória ou resposta lenta | Feche outros programas. Para reduzir o modelo, veja a opção abaixo.                                                                             |
| A janela permanece indexando       | Aguarde; o primeiro carregamento e a geração na CPU podem demorar.                                                                              |
| Banco já está em uso               | Pare `npm.cmd run dev` com Ctrl+C antes da preparação/reindexação.                                                                              |
| `setup:ollama` não existe          | Você está em uma versão antiga ou em outra pasta. Use o pacote 1.3 e a pasta com `package.json`.                                                |
| Chat mostra modo demonstração      | Confira `AI_PROVIDER=ollama` no `.env` e reinicie `npm.cmd run dev`.                                                                            |
| `needsReindex=true`                | Pare o servidor e execute `npm.cmd run rag:reindex` com o Ollama aberto.                                                                        |
| Teste gera resposta inválida       | Repita `npm.cmd run integrations:check`; confirme os modelos indicados acima. Modelos menores podem falhar mais no formato ou na fundamentação. |

Para diagnosticar sem alterar o catálogo, pare o MedFinder e execute `npm.cmd run integrations:check`. `ollama-live` precisa ficar `ok: true`. A revisão clínica permanece separada desse teste técnico.

## Ajustes opcionais

Para usar um gerador menor:

```powershell
ollama pull qwen3:1.7b
notepad .env
```

Troque apenas `OLLAMA_MODEL=qwen3:4b-instruct-2507-q4_K_M` por `OLLAMA_MODEL=qwen3:1.7b`, salve, execute `npm.cmd run integrations:check` e reinicie o MedFinder. O modelo menor pode ter qualidade inferior e não foi validado nesta entrega. O perfil padrão usa a variante Instruct 2507, verificada no teste técnico descrito em VALIDACAO.md. Trocar só o gerador não exige reindexação.

Trocar o modelo de embeddings exige ajustar `OLLAMA_EMBEDDING_MODEL` e `OLLAMA_EMBEDDING_DIMENSIONS` ao modelo escolhido e executar `npm.cmd run rag:reindex`. Não misture embeddings de modelos diferentes. Reindexe também após atualizar os pesos do modelo sob a mesma etiqueta, pois a etiqueta não fixa o digest dos pesos.

O limite por operação é `OLLAMA_TIMEOUT_MS=180000` (três minutos). O navegador aguarda embeddings + geração; você pode interromper o envio. O cancelamento no navegador não descarrega imediatamente o modelo: o servidor termina a operação ou atinge seu limite. `AI_MAX_CONCURRENCY=1` evita várias gerações simultâneas neste perfil.

O modo local aceita apenas um endereço de loopback, consulta os metadados do modelo antes de enviar texto e rejeita modelos remotos/cloud e redirecionamentos. Não há fallback automático para OpenAI. Como proteção adicional no próprio Ollama, você pode desativar recursos de nuvem:

```powershell
[Environment]::SetEnvironmentVariable('OLLAMA_NO_CLOUD', '1', 'User')
```

Depois, encerre o Ollama pelo ícone próximo ao relógio e abra-o novamente. Não basta colocar essa variável no `.env` do MedFinder: o Ollama é outro processo.

O perfil foi preparado para **Node e Ollama no mesmo computador, sem Docker**. Um backend em container não consegue acessar o Ollama do host usando `127.0.0.1`; esse arranjo precisa de configuração de implantação própria.

Configuração manual: copie `.env.ollama.example` para `.env` na raiz do projeto (junto de `package.json`). Em uma instalação de servidor, preserve os campos do banco, HTTPS e revisão de conteúdo; execute `npm.cmd run setup:connected -- caminho/conhecimento-aprovado.json` com `AI_PROVIDER=ollama`. Esse comando utiliza o provedor configurado e não ativa OpenAI automaticamente.

## Referências oficiais

- [Ollama para Windows](https://docs.ollama.com/windows)
- [Geração estruturada](https://docs.ollama.com/capabilities/structured-outputs)
- [Embeddings locais](https://docs.ollama.com/api/embed)
- [Qwen3 4B](https://ollama.com/library/qwen3:4b-instruct-2507-q4_K_M)
- [BGE-M3](https://ollama.com/library/bge-m3)
- [BGE-M3: especificações do autor](https://huggingface.co/BAAI/bge-m3)
- [Desativar nuvem e configuração](https://docs.ollama.com/faq)
