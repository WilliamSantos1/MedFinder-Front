import { expect, test } from '@playwright/test';

test('interface identifica IA local e envia relato sem solicitar chave ou consentimento OpenAI', async ({
  page,
}) => {
  // UI contract fixture: live local inference is validated separately in docs/VALIDACAO.md.
  await page.route('**/api/catalog', async (route) => {
    const response = await route.fetch();
    const catalog = await response.json();
    await route.fulfill({
      json: { ...catalog, mode: 'ollama', requiresConsent: false, chatTimeoutMs: 390000 },
    });
  });
  await page.route('**/api/chat', async (route) => {
    expect(route.request().postDataJSON().consent).toBe(false);
    await route.fulfill({
      json: {
        id: 'local-ui-fixture',
        mode: 'ollama',
        answer: 'Uma avaliação presencial pode ajudar a orientar o próximo passo.',
        urgency: 'routine',
        specialtyIds: ['clinica-medica'],
        questions: [],
        clinics: [],
        sources: [
          {
            id: 'source-fixture',
            title: 'Avaliação inicial',
            url: 'https://www.nhs.uk/symptoms/neck-pain-and-stiff-neck/',
            publisher: 'Fixture de interface',
            excerpt: 'Orientação inicial.',
            reviewStatus: 'draft',
          },
        ],
        notice: 'Não substitui avaliação médica.',
      },
    });
  });
  await page.goto('/');
  await expect(page.getByText('IA local · Ollama', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByLabel('Descreva o que você está sentindo').fill('Estou com dor no pescoço');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByText('IA LOCAL · COM FONTES', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Uma avaliação presencial pode ajudar a orientar o próximo passo.'),
  ).toBeVisible();
  await page.getByText('1 fonte consultada').click();
  await expect(page.getByRole('link', { name: 'Avaliação inicial' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
});
