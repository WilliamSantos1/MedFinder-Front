# Validação da entrega 1.3

Validação em 24/09/2026. As versões de dependências da entrega anterior foram preservadas; mudou a versão do projeto para 1.3.0. Não há pacote ou credencial Docplanner na execução.

## Verificações desta versão

| Verificação                                        | Resultado                                           |
| -------------------------------------------------- | --------------------------------------------------- |
| ESLint, TypeScript estrito, build frontend/backend | Aprovados                                           |
| Vitest                                             | 69 testes aprovados em 6 arquivos                   |
| Playwright                                         | 2 novos fluxos Ollama aprovados: desktop e celular  |
| CLI `setup:ollama`                                 | Criação automática do `.env` e teste real aprovados |

A validação de interface desta atualização cobre identificação do modo local, envio sem consentimento OpenAI, resposta com fontes e largura em desktop/celular, usando fixture HTTP de IA. Os 12 fluxos de navegador da versão 1.2 foram aprovados naquela entrega e não foram repetidos integralmente nesta versão.

O Chromium precisou ser instalado novamente neste ambiente. A configuração de fontes do navegador de teste foi corrigida antes da execução aprovada; isso não exigiu alteração no CSS da aplicação.

## Escopo automatizado

- TypeScript estrito, ESLint, build Vite e compilação do servidor Node.
- PostgreSQL real em memória via PGlite, com pgvector e SQL parametrizado.
- Relato → trecho de orientação → especialidade validada → clínica real com cidade/convênio respeitados.
- Recuperação dos oito temas: pescoço, pele, cabeça, abdômen, ouvido, olhos, costas e ansiedade.
- Catálogo de 20 unidades, três cidades, nove especialidades e onze domínios de fontes; IDs únicos, fonte e data obrigatórias.
- Busca sem diferenciar acentos e caixa, paginação sem repetição, filtros e resultados vazios sem invenção de convênios.
- Importação idempotente, substituição da coleção preservando registros manuais, desativação de exemplos e rejeição de lote inválido antes da gravação.
- Migração da versão anterior desativando o snapshot da API retirada sem apagar os registros.
- Cadastros vencidos ocultos; reimportação não inventa uma nova verificação.
- Ingestão de documentos por hash, reindexação preservando a versão anterior em falha e isolamento entre modelos de embeddings.
- Consentimento, limites HTTP, origem, ausência de tabelas de relatos, referências inventadas rejeitadas e erros externos sem vazamento de conteúdo.
- SDK OpenAI real com transporte HTTP simulado: embeddings + Responses + pgvector + catálogo. O teste de conexão sintético foi exercitado em sucesso e falha; o relatório separa `allPassed`, `clinicalReviewComplete` e `liveVerified`.
- Ollama: HTTP nativo, formato estruturado e referências limitadas às fontes recuperadas; vetores de 1024 dimensões, isolamento entre modelos, lote incompleto, timeout, rejeição de alias remoto/cloud e ausência de cabeçalho de autorização.
- Configuração automática: criação do `.env`, backup privado da configuração anterior, preservação das opções Ollama existentes e proteção de configurações de servidor.
- Reindexação explícita força novo cálculo mesmo quando a etiqueta do modelo não mudou.
- Playwright da atualização: modo local e fontes em desktop e celular; os testes de interface não executam o modelo real.

## Teste com modelos locais reais

Foi executada inferência em **Ollama 0.34.4, Linux, CPU, sem chave OpenAI**, com `OLLAMA_NO_CLOUD=1`, `qwen3:4b-instruct-2507-q4_K_M` e `bge-m3`. O BGE-M3 indexou os oito documentos em pgvector; o teste de conexão confirmou embeddings e geração.

No caso sintético “Estou com dor no pescoço há três dias. Quero encontrar uma consulta.”, com cidade Fortaleza e sem filtro de convênio, a API retornou HTTP 200, `mode=ollama`, uma fonte válida de pescoço e três clínicas reais: CTI, FAM e Mário de Assis. O catálogo veio do banco; não foi escrito pelo modelo. A chamada de chat levou aproximadamente **51 segundos nesta CPU**. Isso não é benchmark nem previsão para o computador do usuário.

Durante o ajuste, respostas do modelo foram rejeitadas pelas validações por incerteza ou afirmação indevida sobre ausência de emergência. A versão final fornece definições e exemplo de formato no prompt e restringe IDs de fontes pelo esquema. O teste técnico aprovado não significa que todas as respostas futuras passarão: a aplicação mantém a abstenção quando faltam evidências ou a resposta viola as regras.

A integração Windows foi implementada com Node e comandos compatíveis com PowerShell, mas **não foi executada no computador do usuário nem em um Windows real**. A instalação do Ollama e os downloads precisam ocorrer no computador em que ele será usado.

## O que não foi comprovado

A entrega não contém uma chave OpenAI real. Os testes do provedor substituem apenas o transporte HTTP; **não** comprovam saldo, acesso aos modelos, qualidade clínica de gerações reais ou disponibilidade da API na sua conta. Execute `npm.cmd run integrations:check` após configurar sua chave. Uma resposta `liveVerified=true` só confirma o teste técnico de embeddings e geração realizado naquele momento.

As fontes cadastrais foram consultadas na web. Isso não é confirmação por telefone, disponibilidade de agenda ou garantia de cobertura por convênio. `docs/CATALOGO.md` documenta as fontes e os limites. Não há API de clínicas nem busca em tempo real neste pacote.

A base médica tem oito resumos de homologação. Nenhum recebeu aprovação clínica fictícia. Testes de software não medem sensibilidade, especificidade, acurácia médica ou conformidade regulatória. Regras de urgência e Structured Outputs não substituem avaliação clínica independente. Os casos de teste são sintéticos, sem dados de pacientes.

O navegador usado é Chromium headless. Docker não está disponível neste ambiente: imagem e Compose não foram executados nesta entrega. PGlite testa SQL e pgvector reais, mas a implantação no PostgreSQL de produção ainda precisa de validação de extensão, migrações, TLS, permissões e restauração de backup no ambiente de destino.

As capturas em `docs/images/` são do aplicativo local. As capturas de catálogo usam a API local e o arquivo real, sem mock da listagem. Elas não mostram uma sessão paga ou uma geração ao vivo da OpenAI.
