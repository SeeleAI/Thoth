import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'

const runId = process.env.THOTH_SELFTEST_RUN_ID ?? ''
const taskId = process.env.THOTH_SELFTEST_TASK_ID ?? 'task-1'
const projectRoot = process.env.THOTH_SELFTEST_PROJECT_ROOT ?? resolve(__dirname, '..', '..', '..')
const sourceRoot = process.env.THOTH_SELFTEST_SOURCE_ROOT ?? resolve(__dirname, '..', '..', '..', '..', '..')
const pythonBin = process.env.THOTH_SELFTEST_PYTHON ?? 'python3'

test('dashboard reflects live runtime state and stop transitions', async ({ page }) => {
  test.skip(!runId, 'THOTH_SELFTEST_RUN_ID is required')

  await page.goto('/overview')
  const runtimeSection = page.locator('section.card').filter({
    has: page.getByRole('heading', { name: 'Runtime Overview' }),
  })
  await expect(runtimeSection.getByRole('heading', { name: 'Runtime Overview' })).toBeVisible()
  await expect(runtimeSection).toContainText('Active Runs')
  await expect(runtimeSection).toContainText(taskId)
  await expect(runtimeSection).toContainText('codex')

  await page.goto('/tasks')
  const taskCard = page.locator('.task-card').filter({ hasText: taskId }).first()
  await expect(taskCard).toBeVisible()
  await taskCard.locator('.task-header').click()

  await expect(taskCard).toContainText('Active Run')
  await expect(taskCard).toContainText(`Run: ${runId}`)
  await expect(taskCard).toContainText('Host: codex')
  await expect(taskCard).toContainText('Freshness: fresh')

  execFileSync(
    pythonBin,
    ['-m', 'thoth.cli', 'run', '--stop', runId],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        PYTHONPATH: process.env.PYTHONPATH
          ? `${sourceRoot}:${process.env.PYTHONPATH}`
          : sourceRoot,
      },
      stdio: 'ignore',
    },
  )

  await expect(taskCard).toContainText('stopped')
  await expect(taskCard).toContainText('Freshness: fresh')
  await expect(taskCard).toContainText('Phase: stopped')
  await expect(taskCard).toContainText('Supervisor: stopped')
  await expect(taskCard).toContainText('supervisor stopping')
})
