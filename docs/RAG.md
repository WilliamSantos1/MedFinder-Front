# RAG de informações das clínicas

## O que mudou

Para sintomas, uma especialidade é sugerida pelo LLM e validada pela taxonomia do banco. Nas pesquisas diretas, nomes e aliases da própria mensagem são resolvidos no banco, sem geração. O índice não contém mais resumos médicos usados para escolher uma especialidade. O arquivo `knowledge.demo.json` foi removido; dados antigos do banco são conservados nas tabelas `legacy_medical_documents` e `legacy_medical_chunks`, sem leitura pelo fluxo atual.

O RAG recupera descrições verificáveis de serviços, público atendido, estrutura e outras características textuais das clínicas **já selecionadas pelo SQL**. Endereço, telefone, cidade, convênio, especialidades e coordenadas continuam no catálogo estruturado. A recuperação não pode recolocar uma clínica incompatível com os filtros.

## Pipeline

1. Administrador verifica uma página/documento oficial e prepara o JSON `clinicDocumentSchema`.
2. Ingestão valida vínculo com clínica existente, tipo real/demo, fonte HTTPS e data real. Para clínica real, o domínio precisa corresponder ao site/fonte já cadastrado. Isso é um controle de procedência, não certificação automática da verdade ou autorização de uso do conteúdo.
3. Texto é dividido em chunks de até 900 caracteres, sobreposição de até 120. Título complementa o texto pesquisável.
4. Embeddings são gerados antes de modificar o banco. Hash de documento + modelo torna reimportação idempotente; atualização de chunks é transacional por documento.
5. Consulta recebe texto redigido e IDs das clínicas já selecionadas. Nenhuma localização é enviada. Um índice vazio/incompatível não aciona embeddings.
6. A CTE materializada filtra IDs, atividade, tipo demo, datas e modelo antes de comparar vetores. Score: 70% similaridade cosseno + 30% componente lexical em português. Modo demo exige correspondência lexical; geração real aceita lexical ou cosseno >=0,38. Esse limiar é técnico e precisa de avaliação no corpus real.
7. Até quatro documentos pertinentes são expostos como trechos com fonte, restritos às clínicas mostradas. Não há uma segunda chamada ao LLM para escolher clínicas ou produzir afirmações de tratamento a partir dos trechos.

`not_indexed`, `no_matches` e `unavailable` são estados distintos. Em todos, a orientação e os cards já validados permanecem disponíveis. Falhas opcionais de indexação inicial são explicitadas pelo setup, sem converter uma IA funcional em indisponível. Em modo OpenAI, consulta de catálogo sem consentimento pula a recuperação (`skipped`) para não enviar texto ao provedor de embeddings.

## Dados incluídos

`data/clinic-documents.public.json` contém **36 resumos curtos, um por unidade real**, com fonte e data próprias. Descrevem serviços e endereços documentados, além da regra de encaminhamento quando aplicável; não afirmam qualidade, indicação terapêutica, agenda ou eficácia. O texto da [Clínica CTI](https://cticlinica.com.br/) mantém a descrição institucional mais detalhada. Os demais são resumos limitados aos fatos publicados; não são um corpus clínico. A preparação do texto não renova a data dos fatos do catálogo.

`data/clinic-documents.demo.json` contém apenas textos fictícios vinculados a clínicas fictícias. Não são usados para inventar serviços de unidades reais. A abrangência textual varia conforme as fontes disponíveis; um resumo não garante resposta para toda pergunta sobre a unidade.

## Importar e atualizar

```powershell
npm.cmd run data:import -- clinic-documents data/clinic-documents.public.json
npm.cmd run rag:reindex
```

Pare a API primeiro ao usar o PGlite local. `setup:ollama`/`setup:connected` tentam indexar os resumos públicos incluídos. Para um lote explícito: `npm.cmd run setup:connected -- caminho/textos.json`. Uma falha nesse lote explícito retorna erro para o operador; documentos concluídos anteriormente no lote podem já estar atualizados.

Trocar provedor/modelo/dimensão exige reindexar documentos de clínicas. Atualizar pesos sob o mesmo nome também exige `rag:reindex` (força o recálculo). Vetores incompatíveis não são misturados. Documentos reais só ficam elegíveis por até 365 dias da verificação; a clínica precisa continuar visível e ter seu cadastro verificado nos últimos 180 dias.

URLs nunca são baixadas durante o chat ou importação. A revisão da fonte é administrativa. Não há crawling, scraping automático, envio de relatos aos sites, busca geográfica por embedding ou dependência de Docplanner.
