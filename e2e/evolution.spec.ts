import { expect, test } from '@playwright/test';

test('localização só após clique; relato → especialidade → clínicas próximas; estado compartilhado', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: -3.73, longitude: -38.52, accuracy: 50 });
  await page.addInitScript(() => {
    const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    Object.assign(window, { geoCalls: 0 });
    navigator.geolocation.getCurrentPosition = (...args) => {
      Object.assign(window, { geoCalls: Reflect.get(window, 'geoCalls') + 1 });
      return original(...args);
    };
  });
  const coordinateRequests: { url: string; method: string; body: string | null }[] = [];
  page.on('request', (request) => {
    if (request.postData()?.includes('latitude') || request.url().includes('latitude'))
      coordinateRequests.push({
        url: request.url(),
        method: request.method(),
        body: request.postData(),
      });
  });
  await page.goto('/');
  await expect(page.getByText('Modo demonstração', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, 'geoCalls'))).toBe(0);
  await page.getByLabel('Convênio', { exact: true }).selectOption('Plano de teste');
  await page.getByRole('button', { name: 'Usar minha localização', exact: true }).click();
  await expect(page.getByText(/Localização ativa/)).toBeVisible();
  await page
    .getByLabel('Descreva o que você está sentindo')
    .fill('Estou sentindo ardência ao urinar desde ontem, sem febre');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByRole('heading', { name: 'Urologia', exact: true })).toBeVisible();
  const chat = page.getByRole('region', { name: 'Conversa com o MedFinder' });
  await expect(chat.locator('.clinic-distance')).toHaveCount(2);
  await expect(chat.locator('.clinic-distance').first()).toContainText(/\d+ m de você/);
  await expect(chat.getByText(/Ordenado por proximidade/)).toBeVisible();
  await page.getByRole('button', { name: 'Encontrar clínicas', exact: true }).click();
  const directory = page.getByRole('region', { name: 'Catálogo de clínicas' });
  await expect(directory.getByText(/Localização ativa/)).toBeVisible();
  await directory.getByLabel('Especialidade', { exact: true }).selectOption('urologia');
  await expect(directory.getByRole('heading', { name: '2 opções encontradas' })).toBeVisible();
  await expect(directory.locator('.clinic-card').first()).toContainText(
    'Unidade fictícia de urologia 1',
  );
  expect(await page.evaluate(() => Reflect.get(window, 'geoCalls'))).toBe(1);
  expect(coordinateRequests.length).toBeGreaterThan(0);
  expect(
    coordinateRequests.every(
      (r) => r.method === 'POST' && !r.url.includes('latitude') && !r.url.includes('-38.52'),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  await directory.getByRole('button', { name: 'Remover localização' }).click();
  await expect(directory.getByText(/Ordenação por nome/)).toBeVisible();
  await expect(directory.locator('.clinic-distance')).toHaveCount(0);
});

test('permissão negada não entra em loop nem impede o chat', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { geoCalls: 0 });
    navigator.geolocation.getCurrentPosition = (_success, failure) => {
      Object.assign(window, { geoCalls: Reflect.get(window, 'geoCalls') + 1 });
      failure?.({
        code: 1,
        message: 'denied',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      });
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Usar minha localização', exact: true }).click();
  await expect(page.getByText(/Permissão de localização negada/)).toBeVisible();
  await page.getByLabel('Cidade', { exact: true }).selectOption('Fortaleza');
  await page
    .getByLabel('Descreva o que você está sentindo')
    .fill('Dor no pescoço desde ontem, piora ao movimentar, sem outros sintomas.');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(
    page.getByRole('heading', { name: 'Ortopedia e Traumatologia', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, 'geoCalls'))).toBe(1);
  await expect(page.locator('.clinic-distance')).toHaveCount(0);
});

test('feedback positivo, alteração para negativo e motivos coerentes', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('Descreva o que você está sentindo')
    .fill('Dor no pescoço desde ontem, piora ao movimentar, sem outros sintomas.');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  const feedback = page.getByRole('region', { name: 'Avaliar resposta' });
  const positive = page.waitForResponse(
    (r) => r.url().endsWith('/api/feedback') && r.status() === 200,
  );
  await feedback.getByRole('button', { name: 'Sim', exact: true }).click();
  await positive;
  await expect(feedback.getByText(/Obrigado pelo feedback/)).toBeVisible();
  await expect(feedback.getByRole('button', { name: 'Sim', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await feedback.getByRole('button', { name: 'Não', exact: true }).click();
  await expect(feedback.getByLabel('Problema com localização/distância')).toHaveCount(0);
  await expect(feedback.getByLabel('Problema com convênio')).toHaveCount(0);
  await feedback.getByLabel('A resposta ficou confusa').check();
  await feedback.getByLabel('Comentário opcional').fill('A explicação poderia ser mais direta.');
  const negative = page.waitForResponse(
    (r) => r.url().endsWith('/api/feedback') && r.status() === 200,
  );
  await feedback.getByRole('button', { name: 'Enviar feedback' }).click();
  const saved = await negative;
  expect(saved.request().postDataJSON()).toMatchObject({
    rating: 'negative',
    reason: 'unclear_answer',
  });
  expect(Object.keys(saved.request().postDataJSON()).sort()).toEqual([
    'comment',
    'rating',
    'reason',
    'responseId',
    'token',
  ]);
  await expect(feedback.getByText(/Obrigado pelo feedback/)).toBeVisible();
  await expect(feedback.getByRole('button', { name: 'Não', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.screenshot({
    path: `test-results/feedback-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test('falha do feedback não quebra a conversa e segurança não oferece motivos eletivos', async ({
  page,
}) => {
  await page.route('**/api/feedback', (route) =>
    route.fulfill({ status: 503, json: { error: 'indisponível' } }),
  );
  await page.goto('/');
  await page.getByLabel('Descreva o que você está sentindo').fill('Estou com dor no peito');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  const feedback = page.getByRole('region', { name: 'Avaliar resposta' }).first();
  await feedback.getByRole('button', { name: 'Sim', exact: true }).click();
  await expect(feedback.getByRole('alert')).toContainText('a conversa continua');
  await feedback.getByRole('button', { name: 'Não', exact: true }).click();
  await expect(feedback.getByLabel('A especialidade sugerida não parece adequada')).toHaveCount(0);
  await expect(feedback.getByLabel('As clínicas apresentadas não foram úteis')).toHaveCount(0);
  const composer = page.getByLabel('Descreva o que você está sentindo');
  await composer.fill('Qual é o próximo passo?');
  await expect(page.getByLabel('Descreva o que você está sentindo')).toHaveValue(
    'Qual é o próximo passo?',
  );
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByRole('heading', { name: 'Busque ajuda imediatamente' })).toHaveCount(2);
});

test('clínicas reais com coordenadas verificadas recebem distância', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: -3.73, longitude: -38.52 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Encontrar clínicas', exact: true }).click();
  const directory = page.getByRole('region', { name: 'Catálogo de clínicas' });
  await directory.getByRole('button', { name: 'Usar minha localização', exact: true }).click();
  await directory.getByLabel('Nome, bairro ou endereço').fill('JULIO LIMA');
  await directory.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(directory.getByRole('heading', { name: 'Clínica CTI', exact: true })).toBeVisible();
  await expect(directory.getByText('Distância não disponível')).toHaveCount(0);
  await expect(directory.locator('.clinic-distance')).toContainText(/\d+[,.]?\d* km de você/);
});

test('preserva o próximo rascunho digitado durante uma resposta que falha', async ({ page }) => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/chat', async (route) => {
    await pending;
    await route.fulfill({ status: 503, json: { error: 'Envio indisponível agora.' } });
  });
  await page.goto('/');
  const input = page.getByLabel('Descreva o que você está sentindo');
  await input.fill('Mensagem sintética inicial');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.getByRole('button', { name: 'Interromper envio' })).toBeVisible();
  await input.fill('Meu próximo rascunho');
  release();
  await expect(page.getByRole('alert')).toContainText('Envio indisponível');
  await expect(input).toHaveValue('Meu próximo rascunho');
});
