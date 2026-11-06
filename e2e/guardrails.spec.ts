import { expect, test } from '@playwright/test';

test('pedido de automedicação recebe limite seguro sem reutilizar especialidade anterior', async ({
  page,
}) => {
  await page.goto('/');

  const input = page.getByLabel(
    'Descreva o que você está sentindo',
  );

  await input.fill(
    'meu olho está vermelho e coçando bastante',
  );

  await page
    .getByRole('button', {
      name: 'Enviar mensagem',
    })
    .click();

  await expect(
    page
      .locator('.assistant-message')
      .last()
      .getByRole('heading', {
        name: 'Oftalmologia',
        exact: true,
      }),
  ).toBeVisible();

  await input.fill(
    'vou tomar Rivotril, pode ser?',
  );

  await page
    .getByRole('button', {
      name: 'Enviar mensagem',
    })
    .click();

  const response = page
    .locator('.assistant-message')
    .last();

  await expect(response).toContainText(
    /não recomenda.*confirma.*prescreve/i,
  );

  await expect(response).toContainText(
    /não tome.*dê.*aplique.*use medicamentos/i,
  );

  await expect(
    response.locator(
      '.specialty-suggestions, .clinic-card',
    ),
  ).toHaveCount(0);

  await expect(response).not.toContainText(
    /Oftalmologia/,
  );
});

test('confirmação curta reaproveita especialidade sem repetir catálogo', async ({
  page,
}) => {
  await page.goto('/');

  const input = page.getByLabel(
    'Descreva o que você está sentindo',
  );

  await input.fill(
    'meu olho está vermelho e coçando bastante',
  );

  await page
    .getByRole('button', {
      name: 'Enviar mensagem',
    })
    .click();

  await expect(
    page
      .locator('.assistant-message')
      .last()
      .getByRole('heading', {
        name: 'Oftalmologia',
        exact: true,
      }),
  ).toBeVisible();

  await input.fill('tem certeza?');

  await page
    .getByRole('button', {
      name: 'Enviar mensagem',
    })
    .click();

  const response = page
    .locator('.assistant-message')
    .last();

  await expect(response).toContainText(
    /Oftalmologia/,
  );

  await expect(response).toContainText(
    /continua sendo a área sugerida/i,
  );

  await expect(
    response.locator('.clinic-card'),
  ).toHaveCount(0);
});

test('nova pessoa com coriza não herda Oftalmologia', async ({
  page,
}) => {
  await page.goto('/');

  const input = page.getByLabel(
    'Descreva o que você está sentindo',
  );

  await input.fill(
    'meu olho está vermelho e coçando bastante',
  );

  await page
    .getByRole('button', {
      name: 'Enviar mensagem',
    })
    .click();

  await expect(
    page
      .locator('.assistant-message')
      .last()
      .getByRole('heading', {
        name: 'Oftalmologia',
        exact: true,
      }),
  ).toBeVisible();

  await input.fill(
    'meu filho de 8 anos está com coriza desde ontem',
  );

  await page
    .getByRole('button', {
      name: 'Enviar mensagem',
    })
    .click();

  const response = page
    .locator('.assistant-message')
    .last();

  await expect(response).not.toContainText(
    /Especialidade sugerida\s*Oftalmologia/i,
  );

  const specialtyHeading =
    response.locator(
      '.specialty-suggestions h2, .specialty-suggestions h3',
    );

  if (
    (await specialtyHeading.count()) >
    0
  ) {
    await expect(
      specialtyHeading.first(),
    ).not.toHaveText(
      'Oftalmologia',
    );
  }
});

test('possível excesso de medicamento informa Disque-Intoxicação', async ({
  page,
}) => {
  await page.goto('/');

  const input = page.getByLabel(
    'Descreva o que você está sentindo',
  );

  await input.fill(
    'tomei 20 comprimidos de Rivotril por engano',
  );

  await page
    .getByRole('button', {
      name: 'Enviar mensagem',
    })
    .click();

  const response = page
    .locator('.assistant-message')
    .last();

  await expect(response).toContainText(
    '0800 722 6001',
  );

  await expect(response).toContainText(
    /SAMU 192/i,
  );

  await expect(
    response.locator(
      '.specialty-suggestions, .clinic-card',
    ),
  ).toHaveCount(0);
});