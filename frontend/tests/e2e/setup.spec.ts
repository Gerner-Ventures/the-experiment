import { test, expect } from '@playwright/test'

test.describe('Setup View', () => {
  test('shows boot sequence on load', async ({ page }) => {
    await page.goto('/')

    // Title should be visible
    await expect(page.getByText('the-experiment')).toBeVisible()

    // Boot lines should appear
    await expect(page.getByText('INITIALIZING SIMULATION ENVIRONMENT')).toBeVisible({ timeout: 5000 })
  })

  test('boot sequence completes and shows config button', async ({ page }) => {
    await page.goto('/')

    // Wait for the "Begin Configuration" button to appear
    const button = page.getByRole('button', { name: /begin configuration/i })
    await expect(button).toBeVisible({ timeout: 15000 })
  })

  test('clicking begin configuration shows the setup screen', async ({ page }) => {
    await page.goto('/')

    const button = page.getByRole('button', { name: /begin configuration/i })
    await expect(button).toBeVisible({ timeout: 15000 })
    await button.click()

    // Should see the experiment configuration header
    await expect(page.getByText('Experiment Configuration')).toBeVisible({ timeout: 5000 })

    // Should see subject cards
    await expect(page.getByText('Subjects', { exact: true })).toBeVisible()
  })
})
