import { expect, test } from '@playwright/test';

test('relato genérico pede detalhes, usa resposta parcial e só então mostra uma especialidade', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.getByLabel('Descreva o que você está sentindo');
  const submit = page.getByRole('button', { name: 'Enviar mensagem' });
  await input.fill('estou com dor de cabeça');
  await submit.click();
  const first = page.locator('.assistant-message').nth(0);
  await expect(first.locator('.follow-up li')).toHaveCount(2);
  await expect(first).toContainText('Há quanto tempo');
  await expect(first.locator('.specialty-suggestions, .clinic-card')).toHaveCount(0);
  await input.fill('Começou ontem.');
  await submit.click();
  const second = page.locator('.assistant-message').nth(1);
  await expect(second.locator('.follow-up li')).toHaveCount(2);
  await expect(second).not.toContainText('Há quanto tempo');
  await expect(second.locator('.specialty-suggestions, .clinic-card')).toHaveCount(0);
  const request = page.waitForResponse((r) => r.url().endsWith('/api/chat'));
  await input.fill('É uma pressão constante, sem outros sintomas.');
  await submit.click();
  const response = await request;
  expect(response.request().postDataJSON().history).toEqual([
    'estou com dor de cabeça',
    'Começou ontem.',
  ]);
  const final = page.locator('.assistant-message').nth(2);
  await expect(final.getByRole('heading', { name: 'Neurologia', exact: true })).toBeVisible();
  await expect(final.locator('.specialty-suggestions section')).toHaveCount(1);
  await expect(final.locator('.follow-up')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  await page.getByRole('button', { name: 'Nova conversa', exact: true }).click();
  await expect(page.locator('.assistant-message')).toHaveCount(0);
});

test('relato detalhado dispensa entrevista; Medicina de Família não aparece nos filtros ou respostas', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Encontrar clínicas', exact: true }).click();
  const options = page.getByLabel('Especialidade', { exact: true }).locator('option');
  await expect(options).toHaveCount(17); // All + 16 active areas, including Pediatrics.
  await expect(page.locator('option[value="medicina-de-familia"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Assistente de saúde', exact: true }).click();
  await page
    .getByLabel('Descreva o que você está sentindo')
    .fill('Dor no pescoço desde ontem, piora ao movimentar, sem outros sintomas.');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  const message = page.locator('.assistant-message').first();
  await expect(
    message.getByRole('heading', { name: 'Ortopedia e Traumatologia', exact: true }),
  ).toBeVisible();
  await expect(message.locator('.follow-up')).toHaveCount(0);
  await expect(message).not.toContainText('Medicina de Família');
});

test('relato sobre filha pede apenas idade e aceita resposta de um caractere', async ({ page }) => {
  await page.goto('/');
  const input = page.getByLabel('Descreva o que você está sentindo');
  const submit = page.getByRole('button', { name: 'Enviar mensagem' });
  await input.fill('Minha filha está com coceira na pele e manchas vermelhas desde ontem.');
  await submit.click();
  const first = page.locator('.assistant-message').first();
  await expect(first.locator('.follow-up li')).toHaveCount(1);
  await expect(first).toContainText('idade da sua filha');
  await expect(first.locator('.specialty-suggestions, .clinic-card')).toHaveCount(0);
  await input.fill('5');
  await expect(submit).toBeEnabled();
  await submit.click();
  const second = page.locator('.assistant-message').nth(1);
  await expect(second.getByRole('heading', { name: 'Pediatria', exact: true })).toBeVisible();
  await expect(second).toContainText('irritação, ressecamento');
  await expect(second.locator('.follow-up')).toHaveCount(0);
  await expect(second.locator('.specialty-suggestions section')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

test('relato detalhado sobre ouvido mostra explicação e orientação sem perguntas', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByLabel('Descreva o que você está sentindo')
    .fill('Meu ouvido está coçando há três dias, começou depois que nadei.');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  const response = page.locator('.assistant-message').first();
  await expect(
    response.getByRole('heading', { name: 'Otorrinolaringologia', exact: true }),
  ).toBeVisible();
  await expect(response).toContainText('diferentes causas');
  await expect(response.locator('.follow-up')).toHaveCount(0);
});

test('caso da imagem prioriza atendimento presencial, preserva a área relacionada e não oferece consulta eletiva', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByLabel('Descreva o que você está sentindo')
    .fill(
      'meu ouvido está doente muito, começou a 3 dias, começou a coçar depois que usei um lapis para coçar, onde eu devo ir?',
    );
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  const response = page.locator('.assistant-message').first();
  await expect(
    response.getByRole('heading', { name: 'Otorrinolaringologia', exact: true }),
  ).toBeVisible();
  await expect(response).toContainText('Área relacionada à avaliação');
  await expect(response).toContainText('irritação ou lesão');
  await expect(response).toContainText('ainda hoje');
  await expect(response.locator('.follow-up, .clinic-card')).toHaveCount(0);
});
