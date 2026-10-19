import { expect, test } from '@playwright/test';

test('relato ocular, especialidade única canônica e continuidade por proximidade', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: -3.7321, longitude: -38.5151 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Usar minha localização', exact: true }).click();
  await expect(page.getByText(/Localização ativa/)).toBeVisible();
  const input = page.getByLabel('Descreva o que você está sentindo');
  await input.fill('meu pai está com dor no olho, onde devo levar ele. ele tem 60 anos');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.locator('.assistant-message').first().locator('.follow-up li')).toHaveCount(2);
  await expect(page.locator('.specialty-suggestions')).toHaveCount(0);
  await input.fill('Desde ontem, com ardência e sem outros sintomas.');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  const first = page.locator('.assistant-message').nth(1);
  await expect(first.getByRole('heading', { name: 'Oftalmologia', exact: true })).toBeVisible();
  await expect(first.locator('.specialty-suggestions section')).toHaveCount(1);
  await expect(first).not.toContainText(
    /Oculista|Outra possibilidade|Especialidade principal|Distância não disponível/i,
  );
  await expect(first.locator('.clinic-distance')).toHaveCount(3);
  const pending = page.waitForResponse((r) => r.url().endsWith('/api/chat'));
  await input.fill('e qual dessas fica mais perto?');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  const response = await (await pending).json();
  expect(response.intent).toBe('clinic_search');
  expect(response.specialty.id).toBe('oftalmologia');
  const distances = response.clinics.map((c: { distanceKm: number }) => c.distanceKm);
  expect(distances).toEqual([...distances].sort((a: number, b: number) => a - b));
  await expect(
    page.locator('.assistant-message').last().locator('.clinic-distance').first(),
  ).toContainText(/\d/);
  await expect(page.locator('.assistant-message').last()).not.toContainText(
    'Distância não disponível',
  );
});

test('consulta direta por convênio e informação de clínica sem pedir sintomas', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.getByLabel('Descreva o que você está sentindo');
  await input.fill('quais clínicas aceitam Unimed?');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.locator('.assistant-message').first().locator('.clinic-card')).toHaveCount(3);
  await expect(
    page.locator('.assistant-message').first().locator('.specialty-suggestions'),
  ).toHaveCount(0);
  await input.fill('onde fica a Clínica CTI?');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.locator('.assistant-message').last().locator('.answer-text')).toContainText(
    'Rua Júlio Lima, 675',
  );
  await expect(page.locator('.assistant-message').last().locator('.clinic-card')).toHaveCount(1);
});

test('tipografia de 16px, cards legíveis e ausência de overflow em zoom de texto', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByLabel('Descreva o que você está sentindo')
    .fill('qual clínica de oftalmologia fica mais perto?');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.locator('.assistant-message')).toHaveCount(1);
  const sizes = await page.evaluate(() => ({
    root: getComputedStyle(document.documentElement).fontSize,
    body: getComputedStyle(document.body).fontSize,
    message: getComputedStyle(document.querySelector('.answer-text')!).fontSize,
    card: getComputedStyle(document.querySelector('.clinic-title-row h3')!).fontSize,
    input: getComputedStyle(document.querySelector('textarea')!).fontSize,
  }));
  expect(sizes.root).toBe('16px');
  expect(sizes.body).toBe('16px');
  expect(sizes.message).toBe('16px');
  expect(parseFloat(sizes.card)).toBeGreaterThanOrEqual(18);
  expect(sizes.input).toBe('16px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.screenshot({
    path: `test-results/navigation-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Encontrar clínicas', exact: true }).click();
  await expect(page.locator('.directory .clinic-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe('32px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.getByRole('button', { name: 'Assistente de saúde', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  expect(
    await page
      .locator('.conversation')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.getByRole('button', { name: 'Como funciona', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});
