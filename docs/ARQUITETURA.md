# Arquitetura e decisões

## Fronteiras

A aplicação é um monólito modular em TypeScript. `buildApp` compõe repositórios, recuperador e provedor por injeção de dependências. A interface `AIProvider` permite trocar o gerador sem acoplar HTTP e domínio. `Database` mantém a mesma interface transacional sobre PGlite e `pg.Pool`. SQL é parametrizado; as migrações são versionadas e transacionais.

O escopo é navegação de cuidados. A taxonomia de especialidades é explícita em `shared/contracts.ts`; não há diagnóstico, receita, consulta médica nem reserva de horários. A associação entre queixas e especialidades deve ser aprovada por profissionais responsáveis pelo conteúdo antes de uso assistencial.

## Geração aumentada por recuperação (RAG)

1. **Ingestão controlada:** operador importa um JSON validado. Cada documento inclui título, fonte HTTPS, conteúdo, palavras-chave, especialidades e revisão.
2. **Versão:** hash SHA-256 do documento e identificação do modelo de embeddings. Uma mudança em qualquer um provoca reindexação; repetir o mesmo conteúdo não duplica registros.
3. **Chunking:** até 900 caracteres, com sobreposição aproximada de 120 e fronteiras de palavras. Limite de 20.000 caracteres por documento. O formato favorece resumos curados, não livros completos.
4. **Embeddings:** Ollama usa `bge-m3` com 1024 dimensões; OpenAI usa `text-embedding-3-small` com 1536 dimensões. O adaptador offline usa feature hashing com o mesmo comprimento, mas identificador separado. Ele não tem compreensão semântica.
5. **Índice:** pgvector para cosseno e `tsvector` em português para texto. Vetores e chunks ficam no banco, ao lado de metadados de origem e revisão.
6. **Consulta:** o relato atual e até dois relatos recentes formam a busca; os seis relatos recentes são o contexto máximo enviado ao gerador. Identificadores comuns são reduzidos antes desses passos.
7. **Ranking:** 70% similaridade cosseno e 30% relevância lexical limitada a 1. Busca exata sobre o corpus pequeno, até 12 candidatos e até 4 documentos distintos. A seleção exclui inativos, dados não autorizados, revisões vencidas e modelos de embedding diferentes.
8. **Abstenção:** no modo demo é necessário acerto lexical; nos modos generativos, sem acerto lexical, exige-se cosseno de pelo menos 0,38. Esse limiar é uma configuração inicial de engenharia, **não uma probabilidade clínica**, e precisa ser calibrado com avaliações reais.
9. **Geração:** Responses API, instruções de navegação de cuidados, `store:false`, timeout de 25 segundos por chamada, sem retentativas automáticas e no máximo 900 tokens de saída. Contexto e fontes são serializados como dados. Nenhuma ferramenta de execução ou acesso livre a banco é disponibilizada ao modelo.
10. **Validação:** Zod, limites de tamanho, IDs de fontes presentes e especialidades contidas nas fontes citadas. Um filtro adicional rejeita padrões simples de prescrição e diagnóstico. Isso reduz riscos, mas não comprova que todas as afirmações decorrem das fontes.
11. **Catálogo:** o servidor monta os cards a partir dos registros do banco. Cidade e convênio são filtros exatos normalizados; especialidades usam correspondência de interseção. Sem correspondência, retorna vazio. Não há recomendação baseada em patrocínio, distância ou avaliação de qualidade médica.

## Alertas de urgência

Regras de texto são avaliadas antes de embeddings, consentimento de IA e geração, considerando o relato e o histórico recebido. Elas cobrem alguns sinais descritos na orientação pública do SAMU e em fontes identificadas, com tratamento restrito de negações. Um alerta interrompe o encaminhamento eletivo. O LLM também pode elevar uma resposta para alerta, nunca reduzir o alerta prévio.

Regex não equivale a triagem validada: linguagem indireta, erros de digitação, contexto temporal, negação complexa, outras línguas e sinais não cadastrados podem falhar. Não apresentar alerta não implica que seja seguro esperar. O produto explicita isso nas respostas e mantém o contato de emergência visível.

## Dados e confiança

| Tabela                | Conteúdo                                                                          |
| --------------------- | --------------------------------------------------------------------------------- |
| `clinics`             | Cadastro JSON validado, cidade normalizada, convênios e especialidades indexáveis |
| `documents`           | Metadados, revisão, conteúdo, hash e modelo de embeddings                         |
| `chunks`              | Trechos, busca textual e vetores na dimensão nativa do modelo                     |
| `catalog_collections` | IDs das unidades gerenciadas por cada coleção local                               |
| `integration_state`   | Histórico da integração retirada, sem acesso ativo                                |
| `schema_migrations`   | Versões aplicadas                                                                 |

Não há tabela de pacientes, mensagens ou sessões. O histórico no browser não usa localStorage, cookies ou IndexedDB. O cliente controla os próprios relatos; o servidor não aceita papéis `system`/`assistant` como histórico. Fontes recuperadas também são tratadas como dados, não como instruções.

Datas de verificação e revisores são declarações do operador. O software não verifica licenças profissionais nem acordos comerciais. A governança deve documentar quem aprovou, quando, qual versão e quais critérios foram usados. As janelas iniciais de 180 dias para clínicas e 365 dias para documentos são decisões de produto ajustáveis via migração/código, não uma norma legal.

## Operação e evolução

- PostgreSQL externo para produção. PGlite usa uma conexão exclusiva e serve ao desenvolvimento.
- Um processo Fastify possui limitadores locais de chamadas por IP e de concorrência. Réplicas exigem rate limiting compartilhado no gateway/Redis, limitação de custos e observabilidade agregada.
- O endpoint de prontidão comprova conexão e conhecimento elegível, mas não valida saldo da OpenAI, precisão médica ou disponibilidade de todas as clínicas.
- Alterar o provedor requer reindexação antes do tráfego. Durante reindexação, versões por documento são transacionais; o lote inteiro não é uma troca atômica. Em produção, realizar em janela de manutenção ou implantar um índice paralelo antes de trocar o tráfego.
- A pesquisa vetorial é exata. Antes de HNSW, medir volume, latência e recuperação com o corpus real e comparar com o baseline.
- Contas, painel administrativo, agendamento, integração com operadoras e busca geográfica não fazem parte desta implementação.
- Antes da operação com pessoas reais: revisão clínica e jurídica aplicável, gestão do ciclo das fontes, avaliações de segurança e qualidade, monitoramento de incidentes e critérios de liberação definidos pelos responsáveis.

## Catálogo versionado na versão 1.2

`server/services/public-catalog.ts` importa a coleção de `data/clinics.public.json` em uma transação. `catalog_collections` guarda os IDs gerenciados por coleção. A substituição desativa os removidos e exemplos fictícios; não apaga o histórico nem desativa importações manuais fora da coleção. A data `verifiedAt` vem do arquivo e nunca é renovada automaticamente pela carga.

A migração 3 desativa registros da antiga API Docplanner. As migrações 1 e 2 permanecem imutáveis para compatibilidade; `integration_state` é uma tabela histórica sem leitor, escritor ou agendador ativo. Nenhuma credencial ou pacote da Docplanner é necessário.

O RAG tem dois tipos de recuperação: os trechos de orientação vêm da busca híbrida vetorial/textual; os fatos de atendimento vêm de SQL com filtros exatos. Cadastros de clínicas não se tornam evidência médica nem são usados para inferir especialidades por proximidade semântica. Os cards são construídos com registros existentes, sem texto de endereço/convênio gerado pelo modelo. O catálogo também oferece busca por palavras no nome, bairro e endereço, com normalização de acentos.

`setup:local` prepara catálogo real e oito documentos de homologação usando o adaptador offline. `setup:ollama` cria a configuração local e prepara os dados com embeddings Ollama; `setup:connected` usa o provedor generativo configurado; o gerador é chamado durante o chat. A carga inicial não sobrescreve documentos não demonstrativos já revisados. `integrations:check` valida embeddings e geração com entrada sintética quando executado pelo operador. As verificações distinguem integração técnica e revisão clínica.

## IA generativa local (1.3)

O adaptador Ollama usa HTTP nativo, `/api/show`, `/api/embed` e `/api/chat`. Não depende do SDK OpenAI nem usa credenciais externas. Endpoint limitado a loopback; redirects recusados; metadados remotos/cloud rejeitados antes de enviar relato ou documentos. Não existe troca automática de provedor. `format` envia o JSON Schema compartilhado, a resposta é validada com Zod e passa pelas mesmas verificações de referências, especialidades e segurança do chat. `think=false` e 8192 tokens de contexto no gerador Qwen3 Instruct 2507. O esquema restringe `sourceIds` aos IDs recuperados, e suas definições também são incluídas no prompt.

A migração 4 altera `chunks.embedding` para `vector` sem dimensão fixa, preservando os vetores antigos. O comprimento é validado pelo adaptador e na ingestão; a chave do índice inclui provedor, modelo e dimensão. Uma CTE materializada filtra documentos pelo modelo antes da distância cosseno, impedindo comparação entre vetores incompatíveis. Trocas de embeddings exigem reindexar; atualizar os pesos sob a mesma etiqueta também exige reindexação manual. O limiar semântico deve ser calibrado por modelo, pois não há equivalência clínica entre scores de provedores diferentes.

O perfil local usa PGlite, concorrência 1 e timeout de 180 s por operação. A API publica `chatTimeoutMs` para o navegador aguardar embeddings + geração. O diretório de clínicas continua em SQL com filtros exatos: o modelo não inventa endereços ou cobertura. Documentos de homologação e revisão clínica mantêm suas regras existentes.
