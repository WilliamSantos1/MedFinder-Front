# Entrega do MedFinder 1.3

A implementação foi preparada a partir do repositório `WilliamSantos1/MedFinder-Front`, commit-base `ba16877da5b0140fd0ba05fb7bdfbd84aac3d1e9`.

O GitHub permitiu consultar e clonar o projeto, mas recusou a tentativa de gravação pela integração com HTTP 403, `Resource not accessible by integration`. Nenhum commit, branch remota ou pull request desta implementação foi criado no GitHub. A entrega está no pacote completo, com um patch binário para aplicação ao repositório original.

## Usar o projeto completo

Extraia o ZIP, entre na pasta `MedFinder` e siga o README. A pasta contém todo o código, assets originais, arquivos de configuração, testes, exemplos e documentação. Dependências, banco local, credenciais e diretório `.git` não fazem parte do pacote.

## Aplicar as mudanças ao GitHub existente

O arquivo `MedFinder-Completo-v1.3.patch`, ao lado da pasta do projeto no ZIP, contém todas as mudanças, incluindo imagens. Use um clone limpo do projeto. Os comandos abaixo não devem ser executados sobre trabalho local ainda não salvo.

```bash
git clone https://github.com/WilliamSantos1/MedFinder-Front.git
cd MedFinder-Front
git switch -c feat/medfinder-catalogo-publico ba16877da5b0140fd0ba05fb7bdfbd84aac3d1e9
git apply --check ../MedFinder-Completo-v1.3.patch
git apply --index ../MedFinder-Completo-v1.3.patch
npm ci
npm run check
git commit -m "feat: integrar IA, RAG e catalogo publico ao MedFinder"
git push -u origin feat/medfinder-catalogo-publico
```

Ajuste o caminho do patch conforme o local em que extraiu o ZIP. O envio usa a sua autenticação normal do GitHub com permissão de escrita no repositório. Depois, abra um pull request da branch `feat/medfinder-catalogo-publico` para `main`. Caso `main` tenha evoluído, revise a integração em uma branch antes de mesclar; `git apply --check` evita aplicar um patch incompatível silenciosamente.

Não compartilhe tokens ou chaves de API no chat, em arquivos públicos ou no código. Para que uma integração faça o envio diretamente, seu proprietário/administrador precisa conceder a ela o acesso de escrita correspondente. O erro 403 não foi contornado nesta entrega.

A atualização 1.3 foi desenvolvida sobre o pacote local anterior. O ZIP inclui os fontes completos e as instruções em `docs/ATIVACAO.md`. Não foi feita nova tentativa de escrita no GitHub nesta atualização; o bloqueio de acesso relatado acima permanece pendente.

## Atualização a partir do pacote 1.2

O ZIP também inclui `MedFinder-Atualizacao-v1.2-v1.3.patch`, aplicável à cópia exata da entrega 1.2. Ele adiciona geração/embeddings Ollama, configuração automática, migração de vetores, testes e documentação. Preserva `.env` e o banco local; `setup:ollama` guarda uma cópia da configuração anterior ao ativar o novo perfil. Siga [OLLAMA.md](OLLAMA.md). Não confunda esse patch incremental com o patch completo contra o commit original do GitHub.
