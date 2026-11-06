# Ollama local — MedFinder 3.0

Modelos recomendados:

```powershell
ollama pull qwen3:1.7b
ollama pull bge-m3
```

`.env`:

```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:1.7b
OLLAMA_EMBEDDING_MODEL=bge-m3
OLLAMA_EMBEDDING_DIMENSIONS=1024
```

Prepare tudo com `npm.cmd run setup:ollama`. O Qwen não é chamado para toda mensagem: fast-path, segurança e consultas diretas ao catálogo são resolvidos localmente. Quando chamado, recebe JSON mínimo e candidatas restritas. O `bge-m3` continua dedicado ao RAG das clínicas selecionadas.
