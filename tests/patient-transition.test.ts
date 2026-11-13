import { describe, expect, it } from 'vitest';
import { clearlyChangedPatient } from '../src/features/chat/patient-transition.js';

describe('Filtro originado pelo chat não vaza entre pacientes', () => {
  it('reconhece a mudança do próprio usuário para o filho', () => {
    expect(clearlyChangedPatient('Meu filho está com coriza', [
      'Estou com dor na pelve', 'Na pelve, perto da virilha',
    ])).toBe(true);
  });
  it('reconhece a mudança de familiar', () => {
    expect(clearlyChangedPatient('Minha esposa está com dor no joelho', [
      'Meu filho está com coriza', 'Ele tem 12 anos',
    ])).toBe(true);
  });
  it('troca de catálogo sem paciente para nova queixa de uma pessoa', () => {
    expect(clearlyChangedPatient('Meu filho está com coriza', [
      'Quais clínicas aceitam Unimed?',
    ])).toBe(true);
    expect(clearlyChangedPatient('Estou com dor nas costas', [
      'Dessas clínicas, quais aceitam CAFAZ?',
    ])).toBe(true);
  });
  it('não reseta apenas por uma resposta curta do mesmo paciente', () => {
    expect(clearlyChangedPatient('Ele tem 12 anos', ['Meu filho está com coriza'])).toBe(false);
    expect(clearlyChangedPatient('Minha esposa piorou da dor no joelho', [
      'Minha esposa está com dor no joelho',
    ])).toBe(false);
  });
});
