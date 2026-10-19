# Feedback no MedFinder

O produto coleta dois tipos de avaliação, ambos **anônimos** e protegidos pelo mesmo comprovante emitido pelo servidor. Não há conta, identificador de usuário nem uso de IP.

| Tipo                   | Pergunta                            | Rota                       | Tabela                  |
| ---------------------- | ----------------------------------- | -------------------------- | ----------------------- |
| Avaliação da resposta  | "Essa resposta foi útil?"           | `POST /api/feedback`       | `ai_feedback`           |
| Avaliação da visita    | "Qual clínica você visitou? Nota?"  | `POST /api/visit-feedback` | `clinic_visit_feedback` |

## Comprovante

Cada resposta do chat recebe um UUID (`id`) e um token aleatório de 256 bits (`feedback.token`). O servidor guarda em `response_receipts` apenas o **hash** do token, o modo, a versão do prompt, os motivos permitidos, os IDs das clínicas indicadas (`clinic_ids`) e a data. O comprovante vale **7 dias** e é a única credencial aceita pelas duas rotas: sem ele, ninguém avalia uma resposta ou clínica arbitrária.

## 1. Avaliação da resposta

Descrita em [API.md](API.md#feedback). Positivo ou negativo, com motivo contextual obrigatório no negativo e comentário opcional (até 500 caracteres, redigido). O voto pode ser alterado por UPSERT.

## 2. Avaliação da visita à clínica

### Fluxo

```
Chat indica clínicas ──▶ navegador grava o comprovante (localStorage)
        │
        ▼
Usuário fecha o app ... passam 6 h ou mais ... abre de novo
        │
        ▼
Janela: "Qual clínica você visitou?" + estrelas + comentário opcional
        │
        ▼
POST /api/visit-feedback ──▶ valida token, validade e clínica ──▶ clinic_visit_feedback
```

### No navegador (`src/features/followup/`)

| Arquivo                      | Função                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `storage.ts`                 | Leitura/escrita validada em `localStorage`; regras de ausência, expiração e limite       |
| `useReturnFollowUp.ts`       | Registra "visto por último" e decide quando perguntar (abertura e retorno de foco)       |
| `ReturnFeedbackDialog.tsx`   | `<dialog>` modal acessível com escolha da clínica, estrelas e comentário                 |

Chave: `medfinder.followup.v1`. Conteúdo: `lastSeen`, e até 5 itens com `responseId`, `token`, `shownAt` e as clínicas (`id`, `name`) daquela resposta.

Parâmetros em `storage.ts` e `useReturnFollowUp.ts`:

| Constante         | Valor     | Significado                                                       |
| ----------------- | --------- | ----------------------------------------------------------------- |
| `MIN_ABSENCE_MS`  | 6 h       | Tempo fora que conta como "voltou depois de um tempo"             |
| `MAX_AGE_MS`      | 6 dias    | Indicações mais antigas são descartadas (o servidor aceita 7)     |
| `MAX_ITEMS`       | 5         | Máximo de indicações pendentes guardadas                          |
| `HEARTBEAT_MS`    | 30 s      | Intervalo de atualização de `lastSeen` com a aba visível          |

Regras:

- Só grava algo quando o chat **indica clínicas**. Respostas de emergência, avaliação presencial, esclarecimento ou sem clínicas não gravam nada, então uma visita sem indicações mantém o `localStorage` vazio.
- `lastSeen` só é atualizado enquanto houver indicações pendentes, e não é renovado com a janela aberta: se a pessoa fechar o app sem responder, a pergunta volta.
- Não existe evento confiável de "fechou o app". O hook usa `visibilitychange`, `pagehide` e o heartbeat, e compara horários na abertura. No celular, o app costuma ficar em segundo plano, por isso o retorno de foco também dispara a pergunta.
- "Não fui a nenhuma", Esc e envio bem-sucedido descartam todas as indicações pendentes. Falha de rede mantém a janela aberta com mensagem de erro.
- Se a mesma clínica foi indicada em várias respostas, a lista mostra uma vez e usa a indicação mais recente.
- Armazenamento indisponível (modo privado, cota cheia) apenas desativa o recurso, sem erro.

### No servidor

`FeedbackRepository.saveVisit` insere em `clinic_visit_feedback` somente se, na mesma consulta:

1. o `response_id` existe e o hash do token confere;
2. o comprovante tem menos de 7 dias;
3. o `clinic_id` está em `response_receipts.clinic_ids`.

Chave primária `(response_id, clinic_id)`: uma nota por clínica por resposta, atualizável. A nota é validada em 1–5 pelo schema e por `CHECK` no banco. O comentário passa por `redactIdentifiers`.

Esquema (migração 11):

```sql
ALTER TABLE response_receipts ADD COLUMN clinic_ids text[] NOT NULL DEFAULT '{}';
CREATE TABLE clinic_visit_feedback (
  response_id uuid NOT NULL,
  clinic_id text NOT NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text CHECK (length(comment)<=500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (response_id, clinic_id)
);
```

Comprovantes anteriores à migração têm `clinic_ids` vazio e não aceitam avaliação de visita.

## Privacidade

- Sem login, sem ID de visitante e sem IP. O navegador guarda localmente o token, os nomes das clínicas indicadas e a data da última visita; o texto "Como suas informações são utilizadas" do app informa isso.
- O comprovante só permite avaliar as clínicas daquela resposta. Não permite ler a conversa, o relato, a localização ou outras avaliações.
- A avaliação enviada contém apenas clínica, nota e comentário opcional. O formulário orienta a não incluir dados pessoais nem sintomas. A redação de identificadores é limitada e não impede informação voluntária em comentário livre.
- A nota é anônima e **não é verificável**: não prova que a pessoa visitou a clínica. Trate-a como sinal de qualidade das indicações, não como ranking público.
- Proxy/APM não devem capturar corpos dessas requisições.

## Retenção

`purgeExpiredReceipts` remove comprovantes vencidos (`npm run feedback:prune`), mas **não** apaga `ai_feedback` nem `clinic_visit_feedback`, que não têm chave estrangeira para o comprovante. Defina uma política de retenção conforme o uso real, por exemplo:

```sql
DELETE FROM clinic_visit_feedback WHERE created_at < now() - interval '24 months';
```

## Consultas administrativas

Não há endpoint de leitura. Consulte direto no banco:

```sql
-- Nota média e quantidade por clínica
SELECT clinic_id, round(avg(rating)::numeric, 2) AS media, count(*) AS avaliacoes
FROM clinic_visit_feedback
GROUP BY clinic_id
ORDER BY avaliacoes DESC;

-- Comentários recentes
SELECT clinic_id, rating, comment, created_at
FROM clinic_visit_feedback
WHERE comment IS NOT NULL
ORDER BY created_at DESC
LIMIT 50;
```

Com poucas avaliações por clínica, a média engana. Evite usar a nota para reordenar ou excluir clínicas antes de ter volume e de definir como tratar avaliações falsas.

## Limites de abuso

Rate limit por rota (`FEEDBACK_RATE_LIMIT`, padrão 20/minuto/IP) e uma avaliação por clínica por resposta. Como cada resposta do chat gera um novo comprovante, alguém pode gerar várias respostas para votar mais de uma vez. O limite do chat (`CHAT_RATE_LIMIT`) reduz isso, mas não elimina.

## Testes

- `tests/visit-feedback.test.ts`: salva, atualiza por UPSERT, redige identificadores; rejeita clínica não indicada, token errado, nota inválida, campo extra e comprovante expirado.
- `e2e/followup.spec.ts`: simula ausência de 8 h via `addInitScript`, escolhe clínica e nota, confere o corpo enviado e que o `localStorage` é limpo depois.
- `e2e/app.spec.ts`: garante que uma visita sem indicações de clínicas não persiste nada no navegador.

Para testar manualmente, reduza `MIN_ABSENCE_MS` em `storage.ts`, peça clínicas no chat, feche a aba, aguarde e reabra. Use sempre o mesmo endereço (`localhost` e `127.0.0.1` têm `localStorage` separado) e **volte o valor para 6 h** depois.