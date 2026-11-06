# MedFinder 3.0 — context/dialog r2

Substitua estes arquivos no projeto:

- server/domain/clarification.ts
- server/services/chat.ts
- server/ai/prompt.ts
- tests/chat-navigation.test.ts

Objetivos:
- manter o histórico completo no chat, mas segmentar focos clínicos para roteamento;
- novo sintoma independente não herdar a especialidade anterior;
- retomar foco antigo quando houver referência explícita;
- pergunta clínica como "refluxo seria ortopedia?" não virar catálogo;
- fast-path preservado em queixas claras;
- 1–2 perguntas curtas em ambiguidade real e no máximo 3 tópicos distintos;
- corrigir mock Vitest de chat-navigation.
