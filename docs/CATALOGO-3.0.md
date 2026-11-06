# Catálogo, profissionais e proveniência — 3.0

## Estado do snapshot

| Métrica | Valor |
|---|---:|
| Unidades privadas/independentes | 50 |
| Documentos RAG de clínica | 50 |
| Áreas com cobertura em pelo menos uma unidade | 34 |
| Nomes de convênios/planos | 35 |
| Vínculos profissional–unidade | 96 |
| Profissionais únicos por nome | 85 |
| Unidades com coordenadas verificadas | 35 |
| URLs-fonte distintas | 39 |
| Domínios-fonte distintos | 38 |

Distribuição: Fortaleza (39), Maracanaú (5), Eusébio (5), Caucaia (1).

## Política de inclusão

Uma unidade pública do snapshot precisa ter:

- nome e unidade identificáveis;
- endereço/cidade;
- pelo menos uma especialidade ativa;
- URL-fonte e data de verificação;
- `isDemo=false`.

Convênio só é incluído quando publicado pela fonte usada no snapshot. Ausência de convênio não é transformada em “não aceita”; a interface informa que a cobertura deve ser confirmada.

## Profissionais

`professionals[]` registra somente vínculos suportados por fonte pública. Cada profissional precisa apontar para uma especialidade que a própria clínica oferece. CRM/RQE ou título só são preenchidos quando a fonte os divulga; o sistema não gera nem infere registro profissional.

A lista não pretende ser corpo clínico completo e pode ficar desatualizada entre verificações.

## Coordenadas

35 unidades têm par latitude/longitude com fonte e data de verificação. As demais permanecem sem distância. O sistema nunca copia coordenada de outra filial e não geocodifica durante o chat.

## Especialidade reconhecida ≠ clínica cadastrada

A taxonomia de navegação é mais ampla que o catálogo. Se o usuário for direcionado a uma especialidade sem cobertura local no snapshot, a resposta conserva a especialidade e retorna `no_matching_clinics`; filtros não são trocados automaticamente.

## Auditoria reproduzível

```powershell
npm.cmd run audit:catalog
```

O script valida esquema, IDs, correspondência dos documentos RAG, profissional-especialidade, fontes e estatísticas do snapshot.
