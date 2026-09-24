import { expect, test } from '@playwright/test';

test('relato → fonte → especialidade → clínica filtrada', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Modo demonstração', { exact: true })).toBeVisible();
  await page.getByLabel('Cidade', { exact: true }).selectOption('Fortaleza');
  await page.getByLabel('Convênio', { exact: true }).selectOption('CASSI');
  await page.getByRole('button', { name: /Estou com dor no pescoço/ }).click();
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByText('Ortopedia', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Clínica CTI' })).toBeVisible();
  await page.getByText('1 fonte consultada', { exact: true }).click();
  await expect(page.getByRole('link', { name: /Dor no pescoço: onde começar/ })).toHaveAttribute(
    'href',
    /nhs.uk/,
  );
  await page.getByRole('button', { name: 'Nova conversa' }).click();
  await expect(page.getByRole('heading', { name: 'Como você está se sentindo?' })).toBeVisible();
});

test('urgência mostra ajuda imediata sem catálogo eletivo', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('Descreva o que você está sentindo')
    .fill('Estou com dor no peito e falta de ar');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByRole('heading', { name: 'Busque ajuda imediatamente' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ligar para o SAMU 192' })).toHaveAttribute(
    'href',
    'tel:192',
  );
  await expect(page.getByText('Opções no catálogo', { exact: true })).toHaveCount(0);
});

test('catálogo filtra e informa quando não há resultados', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Encontrar clínicas', exact: true }).click();
  const directory = page.getByRole('region', { name: 'Catálogo de clínicas' });
  await directory.getByLabel('Cidade', { exact: true }).selectOption('Fortaleza');
  await directory.getByLabel('Especialidade', { exact: true }).selectOption('dermatologia');
  await expect(directory.getByRole('heading', { name: 'AVA Clínica Médica' })).toBeVisible();
  await expect(directory.getByRole('heading', { name: '3 opções encontradas' })).toBeVisible();
  await directory.getByLabel('Cidade', { exact: true }).selectOption('Maracanaú');
  await expect(
    directory.getByRole('heading', { name: 'Nenhuma opção para esses filtros' }),
  ).toBeVisible();
});

test('falha de rede mantém o relato para reenvio', async ({ page }) => {
  await page.goto('/');
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Tente novamente em instantes.' }),
    }),
  );
  const input = page.getByLabel('Descreva o que você está sentindo');
  await input.fill('Minha pele está coçando');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByRole('alert')).toContainText('Tente novamente');
  await expect(input).toHaveValue('Minha pele está coçando');
});

test('layout não transborda e dados não são persistidos no navegador', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Como você está se sentindo?' })).toBeVisible();
  const state = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
    stored: localStorage.length + sessionStorage.length,
  }));
  expect(state.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(state.viewport).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(state.stored).toBe(0);
  await page.screenshot({
    path: `test-results/home-${test.info().project.name}.png`,
    fullPage: true,
  });
});
