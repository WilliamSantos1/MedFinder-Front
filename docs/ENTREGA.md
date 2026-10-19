# Atualizar a instalação existente

Esta entrega 2.3.1 evolui o código do repositório `WilliamSantos1/MedFinder-Front`. Não precisa criar outra pasta de publicação, branch ou aplicar um patch para executar uma cópia completa.

Se você já usa a versão 2.3, esta integração não muda banco, modelos ou catálogo. Basta substituir o código preservando `.env`, `.data` e `.git`, executar `npm.cmd ci` e depois `npm.cmd run dev`. Veja [os commits integrados](INTEGRACAO-EQUIPE.md). Para versões anteriores, siga a atualização completa abaixo.

1. Pare o servidor local (Ctrl+C).
2. Faça backup do projeto e da pasta de dados configurada no `.env`.
3. Atualize os arquivos de código mantendo seu `.git`, `.env` e `.data`. Não copie `node_modules` de outra máquina.
4. Na pasta de `package.json`, execute:

```powershell
npm.cmd ci
npm.cmd run db:migrate
npm.cmd run setup:ollama
npm.cmd run dev
```

Abra `http://localhost:5173`. As migrações atualizam o banco sem apagá-lo. A migração 10 habilita Pediatria e a 9 mantém Medicina de Família e Comunidade desativada; `setup:ollama` importa as 36 unidades com coordenadas e tenta indexar seus textos, incluindo Pediatria na Clínica Angellus. Apenas `db:migrate` não substitui o catálogo antigo. Backend e frontend devem ser atualizados juntos para permitir respostas curtas de idade, como “5”, também na interface. Não há mais dependência de `data/knowledge.demo.json`; se esse arquivo sobrar de uma extração anterior, remova apenas esse arquivo antigo de código/dados demo, não a pasta do banco.

Valide no seu Ollama com `npm.cmd run integrations:check`. Teste “estou com dor de cabeça” ou “estou sentindo muita dor no pescoço”: inicialmente devem aparecer perguntas, sem especialidade ou clínicas. Responda sobre início, características e demais sintomas. Só com contexto suficiente e candidata válida haverá recomendação; alertas de urgência interrompem o fluxo. Um relato já detalhado pode dispensar perguntas. Confira também que Medicina de Família e Comunidade não aparece no filtro de especialidade.

Teste também:

- “Meu ouvido coça depois que nadei”: não deve exigir preencher um formulário se houver candidata válida.
- O relato da imagem (ouvido doendo após uso de lápis): deve priorizar avaliação presencial, com área relacionada e explicação curta, sem questionário ou clínicas eletivas.
- “Minha filha está com coceira na pele e manchas desde ontem”: deve perguntar a idade. “5” usa o histórico; “25 anos” não trata a filha como criança.
- “Minha filha de 5 anos está com coceira e manchas”: não deve repetir a idade. Uma criança pode receber outra especialidade quando a queixa justificar; não há encaminhamento obrigatório de toda criança à Pediatria.

Os adaptadores enviam o novo prompt/schema automaticamente. Não é preciso baixar novamente os modelos locais. A execução real no seu Ollama pode variar; os testes automatizados usam demonstração e transportes simulados.

Para publicar suas alterações no repositório já configurado, revise primeiro o diff e os arquivos ignorados. Não versione `.env`, `.data`, `node_modules`, builds ou relatórios de teste. `git status` e `git diff` mostram o conteúdo concreto antes de adicionar/commitar. Não use `push --force` para atualizar o projeto.

As instruções não afirmam que o código foi publicado no GitHub: publicação depende do acesso de escrita ao repositório e deve ser confirmada pelo commit remoto.
