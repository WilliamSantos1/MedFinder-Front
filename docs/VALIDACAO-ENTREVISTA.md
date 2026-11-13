# Validação da entrevista contextual — 07/11/2026

## Execução desta entrega

| Verificação | Resultado |
| --- | --- |
| `npm run check` | Aprovado: ESLint, tipagem de cliente/servidor/scripts, build e 639 testes em 20 arquivos. |
| `npm run test:e2e` | Aprovado: 70 testes, 35 desktop e 35 mobile. |
| `npm audit --package-lock-only` | Zero vulnerabilidades reportadas no lockfile desta entrega. |
| `npm ci --dry-run --ignore-scripts --no-audit --no-fund --offline` | Plano de instalação aceito. Não representa uma instalação limpa executada neste ambiente. |

O `check` concluiu em 48,88 segundos na etapa Vitest; os E2E finais concluíram em aproximadamente 1,1 minuto. Esses tempos são da suíte automatizada, não da inferência real do Qwen.

## Regressões exercitadas

- A frase exata “bom dia, estou com uma dor nas costas, o que fazer?” inicia esclarecimento sem Pediatria e sem clínicas.
- Dores pouco descritas em costas, pé, ombro e joelho passam pela coleta de contexto antes da indicação.
- Um “não” à pergunta de sinais associados continua conhecido ao responder duração e esforço depois.
- Um “sim” a uma lista pede identificar o sinal; repetida ambiguidade não produz consulta eletiva.
- Fraqueza, dormência ou formigamento nas duas pernas e alterações relevantes de controle urinário, junto de dor nas costas, interrompem a busca eletiva mesmo quando informados em outro turno.
- A prioridade de emergência é preservada quando também há febre; negações explícitas não são convertidas nesses alertas.
- Duração de sintomas não é idade. Idade do cuidador não é idade da criança. Respostas curtas de idade ficam ligadas à pergunta e à mesma pessoa.
- Pediatria antiga não é reafirmada sem evidência de idade; consultas explícitas ao catálogo pediátrico continuam funcionando.
- Saídas forçadas de Pediatria, Cirurgia Pediátrica, área incompatível com a lista e área inexistente são rejeitadas.
- Uma candidata acompanhada de pergunta útil resulta em esclarecimento. Perguntas sobre fatos já conhecidos não são repetidas.
- Respostas insuficientes ao fim da entrevista produzem uma porta de entrada ampla com explicação da limitação.
- Convênios consultados no meio da entrevista não respondem perguntas clínicas nem eliminam o filtro que será aplicado às clínicas.
- As regressões anteriores de segurança, isolamento de pessoa/queixa e catálogo continuam passando, inclusive a matriz dos vínculos de convênios.

## Ambiente e alcance

A execução usou Linux, Node 24.22.1, npm 11.9.0 e PGlite em memória. Os E2E abriram a interface real no Chrome Headless Shell por `PLAYWRIGHT_CHROMIUM_EXECUTABLE`; no Windows, o comando padrão usa o Chromium do Playwright.

Os fluxos automatizados usam o provedor de demonstração e respostas controladas. Há também uma integração pelo adaptador Ollama real, com HTTP simulado devolvendo deliberadamente Pediatria incorreta, validando serialização, lista autorizada e rejeição da saída. Nenhuma sessão com pesos reais do Qwen nem chamada externa real à OpenAI foi executada. Portanto, não há medição ou garantia de dez segundos no computador do usuário.

A saída da IA é estruturada e não escreve diretamente a orientação exibida nem dados de clínicas. O RAG permanece restrito às unidades selecionadas pelo SQL. Não há nova dependência ou migração de banco; foram preservados o override de minimatch e o lockfile auditado.

A revisão do prompt é `care-navigation-3.0.3`. O feedback usa essa constante, inclusive no teste, eliminando a necessidade de corrigir manualmente uma versão literal no teste a cada revisão.

## Referência de segurança

A referência consultada para os sinais associados à dor nas costas foi a orientação pública do NHS: https://www.nhs.uk/conditions/back-pain/ (consulta em 07/11/2026). O sistema adapta o destino do atendimento ao contexto brasileiro. A faixa menor de 18 anos exigida para sugestão automática pediátrica é uma política conservadora deste aplicativo, não uma afirmação sobre o limite universal da especialidade.

## Limites

Passar nos testes verifica os cenários definidos, não acerto clínico universal. Não houve validação clínica independente e o sistema não substitui avaliação profissional. Uma queixa pode admitir mais de uma porta de entrada. O cadastro continua com as informações de convênio existentes; cobertura ausente não foi inventada e produto/procedimento/profissional precisam ser confirmados com a unidade.

O contexto de perguntas e respostas é limitado a três turnos de entrevista e às seis mensagens anteriores do usuário. Ele fica na sessão e é descartado ao iniciar nova conversa. O pacote não contém configuração pessoal nem dados locais do usuário.
