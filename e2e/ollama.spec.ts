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
        id: 'd5358b14-5d54-4d16-9d97-81aa2d757572',
        mode: 'ollama',
        answer: 'Uma avaliação presencial pode ajudar a orientar o próximo passo.',
        urgency: 'routine',
        specialty: { id: 'clinica-medica', name: 'Clínica Médica', reason: 'Avaliação possível.' },
        intent: 'care_navigation',
        context: null,
        status: 'no_matching_clinics',
        ragStatus: 'skipped',
        locationUsed: false,
        feedback: null,
        questions: [],
        clinics: [],
        sources: [],
        notice: 'Não substitui avaliação médica.',
      },
    });
  });
  await page.goto('/');
  await expect(page.getByText('IA local · Ollama', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByLabel('Descreva o que você está sentindo').fill('Estou com dor no pescoço');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByText('IA LOCAL', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Uma avaliação presencial pode ajudar a orientar o próximo passo.'),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
});
