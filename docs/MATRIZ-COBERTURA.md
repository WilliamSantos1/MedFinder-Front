# Matriz de cobertura de navegação

A matriz abaixo descreve **rotas de cuidado**, não diagnósticos. Urgências são interceptadas antes dela.

| Grupo de queixa | Exemplos de linguagem | Rota principal / tratamento |
|---|---|---|
| Olhos/visão | olho vermelho, coceira ocular, catarata, glaucoma | Oftalmologia |
| Ouvido/nariz/garganta | zumbido, ouvido, sinusite, rouquidão | Otorrinolaringologia |
| Alergia/imunidade | alergia, urticária, alergia alimentar | Alergologia e Imunologia |
| Pele/cabelo/unhas | acne, micose, manchas, queda de cabelo | Dermatologia |
| Musculoesquelético | dor no joelho, trauma, coluna, ombro | Ortopedia e Traumatologia |
| Neurológico | enxaqueca, tremor, epilepsia, Parkinson | Neurologia |
| Cardiovascular | palpitação, arritmia, hipertensão | Cardiologia |
| Respiratório | asma, DPOC, chiado | Pneumologia |
| Digestivo | refluxo, gastrite, fígado, Crohn | Gastroenterologia |
| Anal/retal | hemorroida, fissura, sangramento retal | Coloproctologia |
| Urinário/prostata | próstata, ardor ao urinar, cálculo urinário | Urologia |
| Renal | insuficiência renal, creatinina, diálise | Nefrologia |
| Hormônios/metabolismo | tireoide, diabetes, hormônios | Endocrinologia e Metabologia |
| Nutrição clínica | deficiência nutricional, sarcopenia | Nutrologia |
| Saúde ginecológica | endometriose, menstruação, menopausa | Ginecologia e Obstetrícia |
| Mama | nódulo mamário, alterações das mamas | Mastologia |
| Sangue/coagulação | anemia, plaquetas, hemofilia | Hematologia |
| Autoimune/reumatológico | lúpus, artrite reumatoide, fibromialgia | Reumatologia |
| Infeccioso | HIV, tuberculose, febre prolongada sem causa | Infectologia |
| Oncológico | câncer conhecido, quimioterapia | Oncologia Clínica |
| Saúde mental | depressão, pânico, bipolaridade, TDAH | Psiquiatria / Psicologia conforme contexto |
| Pessoa idosa | fragilidade, quedas, polifarmácia | Geriatria |
| Vascular | varizes, doença arterial/venosa | Cirurgia Vascular e Angiologia |
| Cirúrgico geral | hérnia, cálculo biliar, cirurgia geral | Cirurgia Geral |
| Genético | doença hereditária, aconselhamento genético | Genética Médica |
| Reabilitação | fisiatria, sequelas, espasticidade | Medicina Física e Reabilitação |
| Esporte | avaliação esportiva, retorno ao esporte | Medicina Esportiva |
| Cabeça/pescoço | massa/nódulo cervical, tumor de cabeça/pescoço | Cirurgia de Cabeça e Pescoço |
| Mão/punho específico | túnel do carpo, dedo em gatilho | Cirurgia da Mão |
| Procedimentos/especialidades explícitas | anestesia, endoscopia, medicina nuclear, radiologia, patologia, radioterapia etc. | especialidade canônica explícita |
| Criança/adolescente com sintomas gerais | febre/cansaço, coriza inespecífica, quadro geral | Pediatria |
| Adulto com quadro reconhecível porém inespecífico | síndrome rara, mal-estar sem rota específica | Clínica Médica |

## Ambiguidades tratadas de propósito

- **rinite**: Otorrinolaringologia × Alergologia e Imunologia;
- **tontura/vertigem**: Neurologia × Otorrinolaringologia;
- **coceira no joelho**: Dermatologia × Ortopedia — não é correto escolher Ortopedia só porque “joelho” apareceu;
- **caroço no pescoço**: Cirurgia de Cabeça e Pescoço recebe prioridade sobre um match genérico de região cervical;
- sintomas muito genéricos pedem **uma única informação discriminante** antes de encaminhar.

Nesses casos o Qwen recebe shortlist. Se falhar ou devolver algo fora da shortlist, o backend usa a porta de entrada ampla.

## Cobertura estrutural

A migração 13 mantém 55 especialidades médicas da taxonomia de referência usada pelo projeto. Por decisão anterior de escopo, Medicina de Família e Comunidade permanece inativa; as outras 54 especialidades médicas ficam navegáveis. `tests/specialty-routing.test.ts` acrescenta Psicologia como área de cuidado separada, totalizando 55 rotas diretas testadas.
