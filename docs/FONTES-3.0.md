# Fontes e governança

## Referências de segurança/taxonomia

- Conselho Federal de Medicina — Resolução CFM nº 2.472/2026, em vigor, homologando a relação atualizada de especialidades e áreas de atuação: https://portal.cfm.org.br/buscar-normas-cfm-e-crm/
- Ministério da Saúde — SAMU 192: https://www.gov.br/saude/pt-br/composicao/saes/samu-192
- Anvisa — Disque-Intoxicação 0800 722 6001: https://www.gov.br/anvisa/pt-br/assuntos/agrotoxicos/disque-intoxicacao

## Fontes do catálogo

Cada registro em `data/clinics.public.json` contém `sourceUrl` e `verifiedAt`. Cada documento em `data/clinic-documents.public.json` também referencia a fonte cadastral correspondente. O snapshot tem 39 URLs-fonte distintas em 38 domínios.

## Regra de atualização

Atualizar fonte não significa apenas trocar a data. O operador deve reconferir nome/unidade, endereço, especialidades, convênios, profissionais e coordenadas. A importação preserva coordenadas operacionais verificadas mais recentemente quando um bundle mais antigo é carregado.

## RQE/CRM

O projeto não infere especialidade médica a partir do nome de um profissional e não inventa RQE. Registro/título só aparece quando publicado na fonte adotada. Na demonstração, descreva esses campos como **cadastro documental**, não como verificação oficial em tempo real.
