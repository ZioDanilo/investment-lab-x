const { test, expect } = require('@playwright/test');

test('real montecarlo browser flow', async ({ page }) => {
  const binaryCalls = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/market-universe/portfolio/projection/binary')) {
      binaryCalls.push({
        url,
        method: request.method(),
        headers: request.headers(),
        postData: request.postData() || null
      });
    }
  });

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/api/market-universe/portfolio/projection/binary')) {
      console.log('BINARY_RESPONSE', response.status(), response.headers()['content-type'], response.headers()['content-length']);
    }
  });

  await page.goto('http://localhost:4200/monte-carlo', { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(2000);

  const portfolioButton = page.getByRole('button', { name: /Seleziona portafoglio/i }).first();
  if (await portfolioButton.count()) {
    await portfolioButton.click();
  }

  const sonia = page.getByText('Sonia').first();
  if (await sonia.count()) {
    await sonia.click();
  }

  const runButton = page.getByRole('button', { name: /AVVIA SIMULAZIONE/i }).first();
  await expect(runButton).toBeVisible({ timeout: 30000 });
  await runButton.click();

  await page.waitForTimeout(15000);

  const bodyText = await page.locator('body').innerText();
  console.log('BODY_SNIPPET_START');
  console.log(bodyText.slice(0, 2000));
  console.log('BODY_SNIPPET_END');
  console.log('BINARY_CALLS', JSON.stringify(binaryCalls, null, 2));

  expect(binaryCalls.length).toBeGreaterThanOrEqual(1);
});
