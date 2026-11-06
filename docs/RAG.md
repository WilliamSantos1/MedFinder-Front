# RAG de clínicas — 3.0

O RAG usa `bge-m3` sobre `data/clinic-documents.public.json`, atualmente com 50 documentos cadastrais. Ele é executado **depois** do SQL e recebe somente os IDs das clínicas já compatíveis com especialidade/cidade/convênio. Não escolhe especialidade, não amplia filtros e não cria clínica.

Se embeddings estiverem indisponíveis, a especialidade e os resultados do catálogo continuam válidos; apenas o enriquecimento por fontes RAG fica indisponível.
