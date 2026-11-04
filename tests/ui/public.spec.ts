import { expect, test, type Page } from '@playwright/test';

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function centered(page: Page, selector: string, maxWidth: number) {
  const box = await page.locator(selector).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(maxWidth);
  expect(Math.abs(box!.x + box!.width / 2 - page.viewportSize()!.width / 2)).toBeLessThan(2);
}

test('public context window supports keyboard interaction through its boundary and reset', async ({ page }) => {
  await page.goto('/articulo/modelo-de-lenguaje');
  const figure = page.locator('figure').filter({ hasText: 'Ventana de contexto' });
  await expect(figure).toBeVisible();
  await expect(figure.getByText('Simplificación educativa: mostramos tres mensajes; los modelos reales usan tokens y límites diferentes.')).toBeVisible();
  await expect(figure.getByText('Mensajes en la ventana: 0 de 3')).toBeVisible();
  await expect(figure.getByText('La ventana está vacía.')).toBeVisible();

  const advance = figure.getByRole('button', { name: 'Avanzar' });
  const reset = figure.getByRole('button', { name: 'Reiniciar' });
  for (let i = 0; i < 20 && !(await advance.evaluate(el => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(advance).toBeFocused();
  const outline = await advance.evaluate(el => ({ style: getComputedStyle(el).outlineStyle, width: parseFloat(getComputedStyle(el).outlineWidth) }));
  expect(outline.style).not.toBe('none');
  expect(outline.width).toBeGreaterThan(0);

  await page.keyboard.press('Enter');
  await expect(figure.getByText('Mensajes en la ventana: 1 de 3')).toBeVisible();
  await expect(figure.getByText('Hola', { exact: true })).toBeVisible();
  for (let i = 0; i < 4; i++) await page.keyboard.press('Enter');
  await expect(advance).toBeDisabled();
  await expect(figure.getByText('Mensajes en la ventana: 3 de 3')).toBeVisible();
  await expect(figure.getByText('Los mensajes anteriores quedaron fuera de esta ventana.')).toBeVisible();
  await expect(figure.getByText('Hola', { exact: true })).toHaveCount(0);
  await expect(figure.getByText('Los mensajes más antiguos pueden quedar fuera.')).toBeVisible();

  // The disabled button is skipped when tabbing; focus reset using the keyboard.
  for (let i = 0; i < 20 && !(await reset.evaluate(el => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(reset).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(figure.getByText('Mensajes en la ventana: 0 de 3')).toBeVisible();
  await expect(figure.getByText('La ventana está vacía.')).toBeVisible();
  await expect(figure.getByText('Los mensajes anteriores quedaron fuera de esta ventana.')).toHaveCount(0);
  await expect(advance).toBeEnabled();
});

for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
  test(`${viewport.name}: public reading and keyboard navigation`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByRole('heading', { name: 'Aprender explicando.' })).toBeVisible();
    await expect(page.getByText('Hola, soy Alexsib.')).toBeVisible();
    await expect(page.getByRole('link', { name: '¿Qué es un modelo de lenguaje?' })).toBeVisible();
    await expect(page.getByText('Borrador privado de prueba')).toHaveCount(0);
    await centered(page, '.listing', 740);
    await noOverflow(page);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Saltar al contenido' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    const outline = await skip.evaluate(el => ({ style: getComputedStyle(el).outlineStyle, width: parseFloat(getComputedStyle(el).outlineWidth) }));
    expect(outline.style).not.toBe('none');
    expect(outline.width).toBeGreaterThan(0);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#contenido$/);
    await page.screenshot({ path: `test-results/${viewport.name}-home.png`, fullPage: true });
    await page.getByRole('link', { name: '¿Qué es un modelo de lenguaje?' }).click();
    await expect(page).toHaveURL(/\/articulo\/modelo-de-lenguaje$/);
    await expect(page.getByRole('heading', { name: '¿Qué es un modelo de lenguaje?' })).toBeVisible();
    await expect(page.getByText(/Un token es un fragmento/)).toBeVisible();
    await centered(page, 'main.reading', 660);
    await noOverflow(page);
    if (viewport.name === 'desktop') await page.screenshot({ path: 'test-results/desktop-article.png', fullPage: true });
    await page.getByRole('link', { name: /Volver al cuaderno/ }).click();
    await expect(page).toHaveURL(/#articulos$/);
    await page.getByRole('link', { name: /sobre-mí/i }).click();
    await expect(page.getByText('Este blog es mi forma de aprender en público.', { exact: false })).toBeVisible();
    await noOverflow(page);
    const draft = await page.goto('/articulo/borrador-privado');
    expect(draft?.status()).toBe(404);
    await expect(page.getByText('Borrador privado de prueba')).toHaveCount(0);
    const missing = await page.goto('/ruta-inexistente');
    expect(missing?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Por acá no hay ninguna página.' })).toBeVisible();
    await noOverflow(page);
    await page.getByRole('link', { name: /Volver al inicio/ }).click();
    await expect(page.getByRole('heading', { name: 'Aprender explicando.' })).toBeVisible();
    // Chromium reports each deliberately requested 404 as a console error.
    expect(errors).toEqual([
      'console: Failed to load resource: the server responded with a status of 404 (Not Found)',
      'console: Failed to load resource: the server responded with a status of 404 (Not Found)',
    ]);
  });
}
