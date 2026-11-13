
import { describe, expect, it } from 'vitest';

import {
  hasCatalogInformationRequest,
  hasCatalogNoun,
  hasInsuranceRequest,
  hasProximityRequest,
  referencesPreviousClinics,
} from '../server/domain/language-intents.js';

import {
  medicationAdviceRequest,
  possibleMedicationPoisoning,
} from '../server/domain/guardrails.js';

describe('Vocabulário português: convênios e contexto do catálogo', () => {
  it.each([
    'Qual dessas clínicas atende pela Unimed?',
    'Quais clínicas atendem meu convênio?',
    'Qual dessas aceita Unimed?',
    'Qual das opções cobre o plano Unimed?',
    'Qual clínica contempla o plano Bradesco?',
    'Tem alguma clínica conveniada à Unimed?',
    'Quais são credenciadas pela Unimed?',
    'Quais trabalham com CASSI?',
    'Alguma faz parte da rede Unimed?',
    'Entre as opções, quais fazem parte da rede Unimed?',
    'Dentre as alternativas, quais fazem parte da rede Bradesco?',
    'Quais faziam parte da rede Unimed?',
    'Quais operadoras essa clínica aceita?',
    'Qual dessas tem cobertura do meu plano?',
    'A CTI faz atendimento pelo plano Unimed?',
  ])('reconhece consulta por convênio: %s', (text) => {
    expect(hasInsuranceRequest(text, true)).toBe(true);
  });

  it.each([
    'Qual especialista atende dor no ombro?',
    'Minha mãe atende por telefone?',
    'Isso cobre a minha necessidade médica?',
    'Onde um médico atende?',
  ])('não confunde verbo isolado com convênio: %s', (text) => {
    expect(hasInsuranceRequest(text, false)).toBe(false);
  });

  it.each([
    'Qual dessas clínicas aceita Unimed?',
    'Entre as três opções, qual fica mais perto?',
    'Entre as opções, quais fazem parte da rede Unimed?',
    'Dentre as alternativas, alguma aceita CASSI?',
    'Entre as unidades mostradas, alguma aceita o plano?',
    'Das opções anteriores, quais aceitam o plano?',
    'Qual delas é da rede?',
    'As clínicas que você indicou',
    'Dessa lista, qual é melhor localizada?',
    'Essas clínicas atendem pelo convênio?',
  ])('identifica referência às opções da resposta anterior: %s', (text) => {
    expect(referencesPreviousClinics(text)).toBe(true);
  });

  it('reconhece diversas maneiras de perguntar sobre distância e serviços', () => {
    expect(
      hasProximityRequest('A clínica fica nas redondezas?'),
    ).toBe(true);

    expect(
      hasProximityRequest('Tem alguma aqui perto?'),
    ).toBe(true);

    expect(
      hasCatalogInformationRequest(
        'Como faço para chegar à clínica?',
      ),
    ).toBe(true);

    expect(
      hasCatalogInformationRequest(
        'Qual é o telefone para agendar?',
      ),
    ).toBe(true);

    expect(
      hasCatalogNoun(
        'Quais opções de tratamento para dor no ombro?',
      ),
    ).toBe(false);

    expect(
      hasCatalogNoun(
        'Quais opções de clínicas para ortopedia?',
      ),
    ).toBe(true);
  });
});

describe('Vocabulário português: medicamentos, riscos e relatos clínicos', () => {
  it.each([
    'Posso ministrar dipirona para ela?',
    'Vou ministrar paracetamol pra ele, tudo bem?',
    'Já ministrei ibuprofeno.',
    'É seguro administrar amoxicilina?',
    'Posso medicar meu filho?',
    'Preciso dar novalgina?',
    'Devo trocar o remédio?',
    'A dipirona serve para isso?',
    'Posso misturar dois medicamentos?',
    'Quais medicamentos são indicados?',
    'Qual é a posologia?',
    'Paracetamol interage com ibuprofeno?',
  ])('intercepta orientação ou decisão de medicamento: %s', (text) => {
    expect(medicationAdviceRequest(text)).toBe(true);
  });

  it.each([
    'Meu avô costuma tomar remédio para o coração e está tonto.',
    'Ele toma remédio para a pressão e teve tontura hoje.',
    'Meu pai faz uso de medicação regularmente e sente dor no ombro.',
    'Qual médico atende dor no ombro?',
    'Posso dar um abraço?',
    'Esse sintoma pode causar tontura?',
  ])('não bloqueia relato clínico ou frase não farmacológica: %s', (text) => {
    expect(medicationAdviceRequest(text)).toBe(false);
  });

  it.each([
    'Minha filha tomou 20 comprimidos por engano.',
    'Eu ministrei 20 comprimidos por engano.',
    'Ele administrou uma dose dupla de remédio.',
    'Ela ingeriu vários medicamentos sem querer.',
  ])('detecta possível intoxicação antes do roteamento clínico: %s', (text) => {
    expect(possibleMedicationPoisoning(text)).toBe(true);
  });
});
