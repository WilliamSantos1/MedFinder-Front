import { describe, expect, it } from 'vitest';
import { detectUrgency, isUnsafeOutput } from '../server/domain/safety.js';
import { redactIdentifiers } from '../server/domain/text.js';

describe('Alertas determinísticos, antes do provedor', () => {
  it.each([
    'Estou com dor no peito e falta de ar',
    'Não consigo respirar',
    'Meu pai está inconsciente',
    'Estou com fala enrolada e fraqueza de um lado',
    'Minha garganta está inchando',
    'Quero me matar',
    'Estou com febre e rigidez na nuca',
    'É a pior dor de cabeça da minha vida',
    'Tenho dor abdominal intensa',
    'Sinto dor muito forte na barriga',
    'Tive perda súbita de visão',
    'Machuquei meu olho',
    'Tenho dor nas costas e fraqueza nas duas pernas',
    'Dor lombar e não consigo controlar a urina',
  ])('prioriza atendimento imediato: %s', (message) => {
    expect(detectUrgency([message])).toBe('emergency');
  });
  it.each([
    'Estou com dor no pescoço',
    'Não tenho dor no peito nem falta de ar',
    'Sem falta de ar, apenas coceira na pele',
    'Dor lombar sem fraqueza nas duas pernas',
  ])('não aciona alerta indevido: %s', (message) => {
    expect(detectUrgency([message])).toBeNull();
  });
  it('considera contraste após negação', () =>
    expect(detectUrgency(['Não tenho febre, mas estou com dor no peito'])).toBe('emergency'));
  it('não perde sinal de alerta do histórico', () =>
    expect(detectUrgency(['Estou com falta de ar', 'Qual clínica aceita meu plano?'])).toBe(
      'emergency',
    ));
  it('combina sinais de alerta entre mensagens', () =>
    expect(detectUrgency(['Estou com rigidez na nuca', 'Também tenho febre'])).toBe('emergency'));
  it('não encaminha trauma cervical para consulta eletiva', () =>
    expect(detectUrgency(['Caí numa queda e machuquei o pescoço'])).toBe('prompt'));
  it('não encaminha dor ocular intensa para consulta eletiva', () =>
    expect(detectUrgency(['Dor intensa no olho'])).toBe('prompt'));
  it('bloqueia prescrições e conclusões diagnósticas simples', () => {
    expect(isUnsafeOutput('Tome ibuprofeno 400 mg')).toBe(true);
    expect(isUnsafeOutput('Seu diagnóstico é infarto.')).toBe(true);
    expect(isUnsafeOutput('Uma avaliação em clínica médica pode ajudar.')).toBe(false);
  });
  it('recusa garantias de ausência de urgência, preservando orientação cautelosa', () => {
    expect(isUnsafeOutput('Não há indicação de emergência.')).toBe(true);
    expect(isUnsafeOutput('Não há sinais de emergência.')).toBe(true);
    expect(isUnsafeOutput('A urgência foi descartada.')).toBe(true);
    expect(isUnsafeOutput('Não é possível descartar uma urgência por mensagem.')).toBe(false);
  });
  it('remove identificadores comuns antes de enviar ao provedor', () => {
    const value = redactIdentifiers(
      'CPF 123.456.789-00. Email pessoa@example.com. Telefone (85) 99999-1234. Dor no pescoço.',
    );
    expect(value).not.toContain('123.456');
    expect(value).not.toContain('pessoa@');
    expect(value).not.toContain('99999');
    expect(value).toContain('Dor no pescoço');
  });
});
