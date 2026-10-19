import { expect, test } from '@playwright/test';

test('retorno após ausência pergunta qual clínica foi e envia a avaliação', async ({ page }) => {
  const old = Date.now() - 8 * 60 * 60 * 1000;
  await page.addInitScript((time) => {
    localStorage.setItem(
      'medfinder.followup.v1',
      JSON.stringify({
        lastSeen: time,
        items: [
          {
            responseId: 'd5358b14-5d54-4d16-9d97-81aa2d757572',
            token: 'a'.repeat(64),
            shownAt: time,
            clinics: [{ id: 'demo-visita', name: 'Clínica Visita' }],
          },
        ],
      }),
    );
  }, old);
  let body: Record<string, unknown> | undefined;
  await page.route('**/api/visit-feedback', async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"status":"saved"}',
    });
  });
  await page.goto('/');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Qual clínica você visitou?')).toBeVisible();
  await dialog.getByLabel('Clínica Visita').check();
  await dialog.getByText('4 estrelas').click();
  await dialog.getByRole('button', { name: 'Enviar avaliação' }).click();
  await expect(dialog).toBeHidden();
  expect(body).toMatchObject({ clinicId: 'demo-visita', rating: 4 });
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});
