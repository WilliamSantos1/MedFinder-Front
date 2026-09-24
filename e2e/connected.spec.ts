import { expect, test } from '@playwright/test';

test('catálogo real tem fonte, paginação e busca por nome sem depender da Docplanner', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Encontrar clínicas', exact: true }).click();
  const directory = page.getByRole('region', { name: 'Catálogo de clínicas' });
  await expect(directory.getByRole('heading', { name: '20 opções encontradas' })).toBeVisible();
  await expect(directory.getByText('CLÍNICA FICTÍCIA', { exact: true })).toHaveCount(0);
  await expect(directory.getByRole('link', { name: 'Fonte do cadastro' }).first()).toHaveAttribute(
    'href',
    'https://avaclinica.com/especialidades/',
  );
  await expect(
    directory.getByText('Convênios não informados. Consulte a clínica.').first(),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/connected-${test.info().project.name}.png`,
    fullPage: true,
    scale: 'css',
    animations: 'disabled',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.getByRole('button', { name: 'Próxima página' }).click();
  await expect(page.getByText('Página 2 de 4')).toBeVisible();
  await page.getByLabel('Nome, bairro ou endereço').fill('JULIO LIMA');
  await directory.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(directory.getByRole('heading', { name: '1 opção encontrada' })).toBeVisible();
  await expect(directory.getByRole('heading', { name: 'Clínica CTI', exact: true })).toBeVisible();
  await expect(directory.getByRole('link', { name: 'Ligar', exact: true })).toHaveAttribute(
    'href',
    'tel:+5585996400000',
  );
  await expect(directory.getByText('CASSI', { exact: true }).last()).toBeVisible();
});
