# MedFinder 1.3: clínicas reais e IA generativa no Windows

A versão elimina a conexão Docplanner. O catálogo vem com 20 unidades reais, obtidas em 11 sites próprios, e funciona sem API de clínicas. Há duas opções de IA generativa: **Ollama local, sem chave ou pagamento**, e OpenAI, com chave e faturamento de API. Para sua instalação local, siga [docs/OLLAMA.md](OLLAMA.md): o comando `npm.cmd run setup:ollama` cria o `.env` automaticamente. Os passos OpenAI abaixo são opcionais.

## 1. Instalar esta atualização

1. Pare a aplicação com **Ctrl+C**.
2. Extraia o ZIP em **uma pasta nova**, por exemplo `MedFinder-v1.3`, preservando sua pasta antiga com o banco e o `.env`.
3. Abra o PowerShell na pasta interna `MedFinder`, onde está `package.json`.
4. Use Node 24 LTS (mínimo 22.16) e execute `npm.cmd ci`. O `.cmd` evita o bloqueio de `npm.ps1` no PowerShell. A autorização do postinstall do esbuild já está registrada para a versão fixada.

## 2. Testar o catálogo e o fluxo sem chave

Somente na pasta nova, sem `.env` configurado:

```powershell
Copy-Item .env.example .env
npm.cmd run setup:local
npm.cmd run dev
```

Abra **http://localhost:5173**. Em “Encontrar clínicas”, há 20 unidades em Fortaleza, Eusébio e Maracanaú, com filtros, paginação, busca por nome/bairro/endereço, telefone e fonte. Para testar o fluxo do chat, escolha Fortaleza, CASSI e “Estou com dor no pescoço”: deve retornar a Clínica CTI, entre as especialidades recuperadas.

Nesse modo, o RAG usa vetores locais para teste e a resposta usa um modelo de texto fixo. **Não é IA generativa e não há um LLM local instalado.** Nenhuma conta paga é necessária para esse teste.

## 3. Opção paga: ativar OpenAI

1. Crie uma chave de projeto em [API keys](https://platform.openai.com/api-keys).
2. Na plataforma OpenAI, configure o faturamento/créditos e limites apropriados. A assinatura do ChatGPT não configura a API deste aplicativo.
3. Pare a aplicação. Abra o `.env` e altere os campos abaixo, **somente no seu computador**:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=COLOQUE_SUA_CHAVE_AQUI
OPENAI_MODEL=gpt-4.1-mini
EMBEDDING_MODEL=text-embedding-3-small
ALLOW_DEMO_DATA=true
AUTO_SEED=false
```

Não sobrescreva seu `.env` inteiro se já estiver configurado. `.env.connected.example` é um modelo completo para instalações novas; ele usa `.data/connected`, um banco separado do demo. Para reutilizar o banco atual, mantenha seu `DATA_DIR`. Não envie a chave pelo chat, GitHub ou frontend; nunca use `VITE_OPENAI_API_KEY`.

4. Com o servidor parado, execute:

```powershell
npm.cmd run setup:connected
npm.cmd run integrations:check
npm.cmd run dev
```

`setup:connected` aplica migrações, gera embeddings dos oito resumos e importa o catálogo público. Documentos idênticos não são reindexados. `integrations:check` testa embeddings e Responses com **texto sintético** e informa `liveVerified=true` se ambos responderem; essas chamadas podem gerar cobrança. Não há chamada à Docplanner.

No chat, autorize o processamento pela OpenAI. Respostas efetivamente geradas terão `mode=openai` e fontes consultáveis. `mode=fallback` informa que não houve uma orientação fundamentada; não conta como sucesso da geração.

O comando de verificação pode informar `allPassed=true`, `clinicalReviewComplete=false`: significa que a integração técnica está pronta para homologação, mas o conteúdo médico ainda não foi aprovado. `setup:check` verifica apenas a configuração e o banco, sem comprovar disponibilidade online. Em produção, revisão clínica é um requisito obrigatório.

## O assistente consegue ativar sozinho?

O código, os dados e os testes podem ser preparados sem suas credenciais — e já estão no pacote. Para usar sua conta OpenAI, é necessário acesso autorizado. O plugin **OpenAI Developers**, se instalado e conectado por você, pode permitir a criação/configuração da chave conforme as permissões da conta. Ele não foi conectado nem utilizado para criar chaves nesta entrega. Alternativamente, configure a chave localmente como acima. Não há chave compartilhada embutida, crédito gratuito garantido ou uso automático da sua assinatura ChatGPT.

## 4. Atualizar uma instalação anterior

Use preferencialmente a pasta nova para evitar sobras de arquivos que foram removidos. Se sua pasta corresponde exatamente ao pacote 1.1 anterior, faça backup e use o patch incremental incluído no ZIP, com Git instalado:

```powershell
git apply --check ../MedFinder-Atualizacao-v1.1-v1.2.patch
git apply ../MedFinder-Atualizacao-v1.1-v1.2.patch
npm.cmd ci
```

Ajuste o caminho do patch. Se a verificação falhar, não force a aplicação: use a pasta nova e integre suas modificações locais. O patch preserva `.env` e `.data/` e remove os fontes antigos Docplanner. Apenas sobrepor os arquivos do ZIP não remove esses arquivos antigos. Depois, com a API parada:

```powershell
npm.cmd run db:migrate
npm.cmd run catalog:load
```

Para atualizar os resumos/embeddings, use `npm.cmd run setup:local` em modo demo ou `npm.cmd run setup:connected` em modo OpenAI. O processo não exige apagar o banco. A migração desativa cadastros da API antiga; os dados históricos são preservados. Variáveis antigas `DOCPLANNER_*` podem ser removidas do `.env`; não são usadas. A carga pública substitui os dois antigos cadastros de diretório pela nova coleção e preserva importações manuais com outros IDs.

O PGlite admite apenas um processo por diretório: pare `dev` antes de qualquer manutenção. PostgreSQL externo não tem essa restrição de arquivo.

## 5. Antes de uso assistencial

Os oito resumos são adaptações editoriais de fontes públicas, marcados como `draft` e `isDemo=true`. Não atribuí um revisor nem uma aprovação inexistentes. Ter vinte clínicas reais melhora o catálogo, mas não valida as orientações médicas.

Para produção, use `.env.production.example`, PostgreSQL externo e conteúdo revisado por responsável clínico. Importe documentos aprovados com fonte, `reviewedBy`, `reviewedAt`, `reviewStatus=approved` e `isDemo=false`. O software não verifica a habilitação do revisor. Execute:

```powershell
npm.cmd run setup:connected -- caminho/conhecimento-revisado.json
npm.cmd run integrations:check
npm.cmd run build
npm.cmd start
```

## Problemas comuns

| Resultado                             | Próximo passo                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `OPENAI_API_KEY` ausente              | Preencher a chave no `.env` do backend                                          |
| Teste online falha                    | Conferir chave, acesso aos modelos, faturamento/créditos, limite e conexão      |
| `needsReindex=true`                   | Com a API parada, executar `npm.cmd run rag:reindex`                            |
| Modo demo após configurar             | Reiniciar a API e confirmar que o terminal está na pasta certa                  |
| Nenhuma clínica com determinado plano | A base não confirma esse vínculo; testar sem filtro e consultar a clínica       |
| Catálogo vazio após meses             | Os registros vencem em 180 dias; reverificar na fonte antes de atualizar a data |

Referências: [OpenAI quickstart](https://developers.openai.com/api/docs/quickstart), [configuração e chaves](https://developers.openai.com/api/docs/guides/production-best-practices), [catálogo e fontes](CATALOGO.md).
