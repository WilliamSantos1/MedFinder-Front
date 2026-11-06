# MedFinder 3.0

MedFinder é um navegador de cuidados para encontrar **a especialidade mais adequada como porta de entrada** e, em seguida, **clínicas compatíveis com especialidade, cidade, convênio e proximidade**. O projeto não diagnostica, não prescreve e não substitui avaliação profissional.

A versão 3.0 foi redesenhada para resolver duas metas ao mesmo tempo: **cobertura ampla de queixas** e **baixa latência**. Casos de associação forte são resolvidos localmente sem LLM; casos ambíguos usam Qwen local apenas como árbitro semântico; se a IA falhar, o sistema conserva uma porta de entrada ampla em Clínica Médica ou Pediatria em vez de encerrar sem orientação.

## O que a versão 3.0 entrega

- roteamento híbrido de queixas → especialidade;
- taxonomia de referência baseada na relação vigente de especialidades médicas do CFM/CME;
- fast-path determinístico para associações fortes como olhos, tireoide, joelho com dor/trauma, próstata, mama, varizes e outras;
- Qwen3 1.7B local somente para ambiguidade real, com shortlist de especialidades autorizadas;
- fallback de navegação em Clínica Médica ou Pediatria quando a queixa é reconhecível mas não permite uma área específica;
- regras determinísticas de urgência antes de IA, catálogo ou RAG;
- bloqueio de prescrição, dose e automedicação;
- orientação de intoxicação com Disque-Intoxicação 0800 722 6001;
- consulta direta ao catálogo sem chamar LLM;
- filtros exatos por especialidade, cidade e convênio;
- aliases conservadores para planos em texto livre;
- ordenação por proximidade somente com coordenadas auditadas;
- RAG com `bge-m3` restrito às clínicas já selecionadas pelo SQL;
- profissionais vinculados às unidades somente quando a fonte pública permite esse vínculo;
- feedback da resposta e feedback posterior sobre a visita;
- dados de localização temporários e não persistidos;
- testes unitários, integração, segurança, catálogo, roteamento e Playwright desktop/mobile;
- auditoria de catálogo e benchmark do roteador.

## Arquitetura resumida

```text
Mensagem
  │
  ├─► Emergência / intoxicação / medicamento ─► resposta segura imediata
  │
  ├─► Pedido explícito de catálogo ────────────► SQL (sem LLM)
  │
  └─► Navegação de cuidado
        │
        ├─► Queixa clara ──────────────────────► especialidade local (fast path)
        │
        ├─► Falta 1 detalhe discriminante ────► 1 pergunta objetiva
        │
        ├─► Ambiguidade ───────────────────────► Qwen local + shortlist
        │
        └─► Falha/baixa confiança ─────────────► Clínica Médica/Pediatria
                                                   │
                                                   ▼
                                  SQL: especialidade + cidade + convênio
                                                   │
                                  localização: ordena coordenadas verificadas
                                                   │
                                                   ▼
                                     RAG somente nas clínicas selecionadas
                                                   │
                                                   ▼
                                    resposta + fontes + feedback
```

Detalhes: [docs/ARQUITETURA-3.0.md](docs/ARQUITETURA-3.0.md).

## Cobertura de dados da distribuição 3.0

- **50** unidades privadas/independentes no snapshot;
- **50** documentos cadastrais no RAG, um por unidade;
- **34** áreas com pelo menos uma clínica visível no catálogo local;
- **35** nomes de convênios/planos publicados no snapshot;
- **96** vínculos profissional–unidade e **85** nomes de profissionais únicos;
- **35** unidades com coordenadas verificadas;
- **39** URLs-fonte distintas, em **38** domínios;
- cidades: Fortaleza, Maracanaú, Eusébio e Caucaia.

O número de especialidades na taxonomia de navegação é maior que a cobertura local de clínicas. Isso é proposital: o MedFinder pode reconhecer uma área médica mesmo quando ainda não há unidade compatível cadastrada; nesse caso informa **nenhuma clínica encontrada sem relaxar os filtros**.

## IA local e desempenho

Configuração recomendada:

```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:1.7b
OLLAMA_EMBEDDING_MODEL=bge-m3
OLLAMA_EMBEDDING_DIMENSIONS=1024
```

O gerador usa `think:false`, contexto 4096, saída curta, temperatura baixa e `keep_alive`. O principal ganho de velocidade da 3.0, porém, não vem de reduzir mais o modelo: **o Qwen não é chamado nos casos de alta confiança nem nas consultas diretas ao catálogo**.

## Instalação local

Requisitos: Node.js 22.16+ e Ollama.

```powershell
npm.cmd ci
ollama pull qwen3:1.7b
ollama pull bge-m3
copy .env.example .env
npm.cmd run setup:ollama
npm.cmd run dev
```

Aplicação: `http://localhost:5173`.

Se você já possui `.env` e banco local, preserve-os. A migração é incremental.

## Validação antes de apresentar ou enviar

```powershell
npm.cmd run check
npm.cmd run test:e2e
npm.cmd run audit:catalog
npm.cmd run audit:routing
npm.cmd run benchmark:routing
# com a API já rodando, opcional:
npm.cmd run benchmark:live
npm.cmd run setup:ollama
```

Depois faça os testes manuais do [roteiro de demonstração](docs/ROTEIRO-DEMO.md).

## Casos de demonstração recomendados

1. `bom dia, meu olho está avermelhado e coçando` → Oftalmologia, sem depender do LLM;
2. `tem certeza?` → confirmação rápida, sem repetir cards/RAG;
3. `meu filho de 8 anos está com coriza desde ontem` → Pediatria, sem herdar a queixa anterior;
4. `estou com tontura` → caso ambíguo, Qwen recebe shortlist controlada;
5. `vou tomar Rivotril, pode ser?` → limite de segurança, sem prescrição;
6. `tomei muitos comprimidos por engano` → orientação de intoxicação;
7. `dor no peito e falta de ar` → emergência antes de IA;
8. `quais clínicas aceitam Unimed?` → catálogo direto;
9. localização ativada → ordenação apenas quando existe coordenada verificada;
10. feedback positivo/negativo e avaliação posterior da visita.

## Limites assumidos explicitamente

“Cobertura completa” significa que uma **queixa médica reconhecível sempre recebe um caminho de navegação**, não que o sistema diagnostica qualquer doença. Uma área específica só é mostrada quando há associação suficientemente forte ou resolução semântica válida; do contrário o MedFinder usa Clínica Médica/Pediatria como porta de entrada. Emergência e segurança sempre vencem o fluxo eletivo.

Os dados de clínicas, planos, profissionais e coordenadas são snapshots com fonte/data e podem mudar. Confirme cobertura, agenda, profissional e disponibilidade diretamente com a unidade.

## Documentação

- [Arquitetura 3.0](docs/ARQUITETURA-3.0.md)
- [Matriz de cobertura](docs/MATRIZ-COBERTURA.md)
- [Catálogo e proveniência](docs/CATALOGO-3.0.md)
- [Validação e métricas](docs/VALIDACAO-3.0.md)
- [Validação executada no artefato](docs/VALIDACAO-ARTEFATO.md)
- [Release notes 3.0](docs/RELEASE-NOTES-3.0.md)
- [Relatório final](docs/RELATORIO-FINAL.md)
- [Critérios de avaliação da disciplina](docs/CRITERIOS-AVALIACAO.md)
- [Roteiro de demonstração](docs/ROTEIRO-DEMO.md)
- [Fontes e governança](docs/FONTES-3.0.md)
- [Operação Ollama](docs/OLLAMA.md)
