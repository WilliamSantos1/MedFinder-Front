import { expect, test, type Page } from '@playwright/test';
import type { ChatResponse } from '../shared/contracts';

async function send(page: Page, message: string): Promise<ChatResponse> {
  const pending = page.waitForResponse((r) => r.url().endsWith('/api/chat'));
  await page.getByLabel('Descreva o que você está sentindo').fill(message);
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  return response.json();
}

test('dor nas costas pergunta antes de escolher e lembra uma resposta curta', async ({ page }) => {
  await page.goto('/');
  const first = await send(page, 'bom dia, estou com uma dor nas costas, o que fazer?');
  expect(first.status).toBe('needs_information');
  expect(first.specialty).toBeNull();
  expect(first.clinics).toEqual([]);
  const message = page.locator('.assistant-message').first();
  await expect(message.locator('.follow-up li')).toHaveCount(2);
  await expect(message.locator('.specialty-suggestions, .clinic-card')).toHaveCount(0);
  const second = await send(page, 'não');
  expect(second.context?.care?.answeredTopics).toContain('associated_symptoms');
  expect(second.context?.care?.questions).not.toContain('associated_symptoms');
  const third = await send(page, 'Começou ontem após carregar peso.');
  expect(third.specialty?.id).toBe('ortopedia');
  await expect(page.locator('.assistant-message').last()).not.toContainText('idade informada');
  await expect(
    page.locator('.assistant-message').last().locator('.clinic-card').first(),
  ).toBeVisible();
});

test('sim a sinais associados exige esclarecimento e um alerta posterior interrompe o catálogo', async ({
  page,
}) => {
  await page.goto('/');
  await send(page, 'Estou com dor nas costas');
  const second = await send(page, 'sim');
  expect(second.specialty).toBeNull();
  await expect(page.locator('.assistant-message').last()).toContainText('Qual dos sinais');
  const third = await send(page, 'Tenho fraqueza nas duas pernas');
  expect(third.mode).toBe('safety');
  expect(third.urgency).toBe('emergency');
  await expect(page.locator('.assistant-message').last()).toContainText('192');
  await expect(page.locator('.assistant-message').last().locator('.clinic-card')).toHaveCount(0);
});

test('entrevista sem informações suficientes explica a indicação ampla', async ({ page }) => {
  await page.goto('/');
  await send(page, 'Estou com dor nas costas');
  await send(page, 'não sei');
  await send(page, 'não sei');
  const final = await send(page, 'não sei');
  expect(final.specialty?.id).toBe('clinica-medica');
  await expect(page.locator('.assistant-message').last()).toContainText('Ainda faltam informações');
  await expect(
    page
      .locator('.assistant-message')
      .last()
      .getByRole('heading', { name: 'Clínica Médica', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator('.assistant-message')
      .last()
      .getByRole('heading', { name: 'Pediatria', exact: true }),
  ).toHaveCount(0);
});

test('idade de criança não é transferida ao cuidador com nova queixa', async ({ page }) => {
  await page.goto('/');
  const first = await send(page, 'Meu filho de 8 anos está com coriza desde ontem');
  expect(first.specialty?.id).toBe('pediatria');
  const second = await send(page, 'Agora sou eu, estou com dor nas costas');
  expect(second.status).toBe('needs_information');
  expect(second.specialty).toBeNull();
  expect(second.clinics).toEqual([]);
  await expect(
    page.locator('.assistant-message').last().locator('.specialty-suggestions'),
  ).toHaveCount(0);
});

test('convênio consultado durante a entrevista filtra as clínicas após a resposta clínica', async ({
  page,
}) => {
  await page.goto('/');
  const first = await send(page, 'Estou com dor no joelho');
  const catalog = await send(page, 'Quais clínicas aceitam Unimed?');
  expect(catalog.context?.care).toEqual(first.context?.care);
  await expect(page.locator('.chat-panel').getByLabel('Convênio', { exact: true })).toHaveValue(
    'Unimed',
  );
  const final = await send(page, 'Começou ontem após correr, sem outros sintomas');
  expect(final.specialty?.id).toBe('ortopedia');
  expect(final.context?.insurance).toBe('Unimed');
  expect(final.clinics.every((clinic) => clinic.insurances.includes('Unimed'))).toBe(true);
});
