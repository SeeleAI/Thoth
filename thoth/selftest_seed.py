"""Seed application templates for Thoth host-real selftests."""

from __future__ import annotations

from pathlib import Path


SEED_FILES: dict[str, str] = {
    ".gitignore": """\
frontend/node_modules/
frontend/dist/
frontend/playwright-report/
frontend/test-results/
__pycache__/
.pytest_cache/
""",
    "README.md": """\
# Thoth Selftest Board

This repository is a disposable FastAPI + Vite kanban board used by the Thoth
heavy host-real selftest.

Known intentional gaps before the host-real workflow runs:

- create-card flow does not yet persist `assignee` and `due_date`
- column updates revert after refresh because backend persistence is incomplete
- backend update endpoint still accepts an empty title
""",
    "backend/requirements.txt": """\
fastapi>=0.100.0
uvicorn>=0.23.0
""",
    "backend/data/cards.json": """\
[
  {
    "id": "card-1",
    "title": "Audit runtime packet flow",
    "column": "todo",
    "assignee": "thoth",
    "due_date": "2026-04-30"
  },
  {
    "id": "card-2",
    "title": "Refresh dashboard checks",
    "column": "in_progress",
    "assignee": "ops",
    "due_date": "2026-05-02"
  }
]
""",
    "backend/app.py": """\
from __future__ import annotations

import json
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


ROOT = Path(__file__).resolve().parent
DATA_PATH = ROOT / "data" / "cards.json"
VALID_COLUMNS = {"todo", "in_progress", "done"}


def _load_cards() -> list[dict]:
    return json.loads(DATA_PATH.read_text(encoding="utf-8"))


def _save_cards(cards: list[dict]) -> None:
    DATA_PATH.write_text(json.dumps(cards, ensure_ascii=False, indent=2) + "\\n", encoding="utf-8")


class CardCreate(BaseModel):
    title: str
    column: str = "todo"


class CardUpdate(BaseModel):
    title: str | None = None
    column: str | None = None
    assignee: str | None = None
    due_date: str | None = None


app = FastAPI(title="Thoth Selftest Board")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/cards")
def list_cards() -> dict:
    return {"cards": _load_cards()}


@app.post("/api/cards", status_code=201)
def create_card(payload: CardCreate) -> dict:
    if payload.column not in VALID_COLUMNS:
        raise HTTPException(status_code=400, detail="invalid column")
    cards = _load_cards()
    card = {
        "id": f"card-{uuid.uuid4().hex[:8]}",
        "title": payload.title.strip(),
        "column": payload.column,
        # Intentional gap: assignee + due_date are not persisted yet.
        "assignee": None,
        "due_date": None,
    }
    cards.append(card)
    _save_cards(cards)
    return card


@app.patch("/api/cards/{card_id}")
def update_card(card_id: str, payload: CardUpdate) -> dict:
    cards = _load_cards()
    for card in cards:
        if card["id"] != card_id:
            continue
        # Intentional review target: empty-title validation is missing.
        if payload.title is not None:
            card["title"] = payload.title
        if payload.assignee is not None:
            card["assignee"] = payload.assignee
        if payload.due_date is not None:
            card["due_date"] = payload.due_date
        # Intentional bug: column updates are ignored, so refresh reverts.
        _save_cards(cards)
        return card
    raise HTTPException(status_code=404, detail="card not found")
""",
    "frontend/package.json": """\
{
  "name": "thoth-selftest-board",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test:e2e": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.55.0",
    "vite": "^5.0.0"
  }
}
""",
    "frontend/vite.config.js": """\
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 4173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
})
""",
    "frontend/index.html": """\
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Thoth Selftest Board</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
""",
    "frontend/src/main.js": """\
import './style.css'

const API_BASE = window.__SELFTEST_API_BASE__ ?? 'http://127.0.0.1:8011'

let cards = []

async function loadCards() {
  const response = await fetch(`${API_BASE}/api/cards`)
  const payload = await response.json()
  cards = payload.cards
  render()
}

async function createCard(event) {
  event.preventDefault()
  const title = document.querySelector('#title-input').value.trim()
  const column = document.querySelector('#column-input').value
  if (!title) {
    return
  }
  await fetch(`${API_BASE}/api/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, column }),
  })
  document.querySelector('#create-card-form').reset()
  await loadCards()
}

async function moveCard(cardId, column) {
  cards = cards.map((card) => (card.id === cardId ? { ...card, column } : card))
  render()
  await fetch(`${API_BASE}/api/cards/${cardId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ column }),
  })
}

function cardMarkup(card) {
  return `
    <article class="card" data-card-id="${card.id}">
      <header class="card-title">${card.title}</header>
      <div class="card-meta">
        <span class="meta-line assignee">${card.assignee ?? 'unassigned'}</span>
        <span class="meta-line due-date">${card.due_date ?? 'no due date'}</span>
      </div>
      <label class="move-label">
        Move to
        <select class="move-card" data-card-id="${card.id}">
          <option value="todo" ${card.column === 'todo' ? 'selected' : ''}>Todo</option>
          <option value="in_progress" ${card.column === 'in_progress' ? 'selected' : ''}>In Progress</option>
          <option value="done" ${card.column === 'done' ? 'selected' : ''}>Done</option>
        </select>
      </label>
    </article>
  `
}

function render() {
  const columns = {
    todo: [],
    in_progress: [],
    done: [],
  }
  for (const card of cards) {
    columns[card.column]?.push(cardMarkup(card))
  }

  document.querySelector('#app').innerHTML = `
    <main class="page-shell">
      <section class="hero">
        <div>
          <p class="eyebrow">Heavy Host-Real Seed</p>
          <h1>Delivery Board</h1>
          <p class="hero-copy">A disposable FastAPI + Vite board used by the Thoth selftest.</p>
        </div>
        <form id="create-card-form" class="create-card-form">
          <h2>Create Card</h2>
          <label>
            Title
            <input id="title-input" name="title" placeholder="Ship host-real workflow" />
          </label>
          <label>
            Column
            <select id="column-input" name="column">
              <option value="todo">Todo</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Done</option>
            </select>
          </label>
          <button type="submit">Create</button>
        </form>
      </section>

      <section class="board-grid">
        <section class="board-column" data-column="todo">
          <h2>Todo</h2>
          <div class="column-body">${columns.todo.join('')}</div>
        </section>
        <section class="board-column" data-column="in_progress">
          <h2>In Progress</h2>
          <div class="column-body">${columns.in_progress.join('')}</div>
        </section>
        <section class="board-column" data-column="done">
          <h2>Done</h2>
          <div class="column-body">${columns.done.join('')}</div>
        </section>
      </section>
    </main>
  `

  document.querySelector('#create-card-form').addEventListener('submit', createCard)
  document.querySelectorAll('.move-card').forEach((node) => {
    node.addEventListener('change', async (event) => {
      await moveCard(event.target.dataset.cardId, event.target.value)
    })
  })
}

loadCards().catch((error) => {
  document.querySelector('#app').innerHTML = `<pre>${String(error)}</pre>`
})
""",
    "frontend/src/style.css": """\
:root {
  color-scheme: light;
  --bg: #f4efe6;
  --ink: #1f1a17;
  --panel: rgba(255, 255, 255, 0.92);
  --accent: #b85c38;
  --accent-soft: #f3d4c7;
  --line: #d7c8bc;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}

body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(circle at top left, #f7d8b4 0, transparent 28%),
    linear-gradient(135deg, #f8f2eb, #efe7da 55%, #e2d7c8);
  color: var(--ink);
}

.page-shell {
  padding: 32px;
}

.hero {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 20px;
  margin-bottom: 24px;
}

.eyebrow {
  margin: 0 0 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent);
  font-size: 12px;
}

.hero h1 {
  margin: 0;
  font-size: 56px;
}

.hero-copy {
  max-width: 540px;
  line-height: 1.5;
}

.create-card-form,
.board-column {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 22px;
  box-shadow: 0 16px 40px rgba(31, 26, 23, 0.08);
}

.create-card-form {
  padding: 20px;
  display: grid;
  gap: 12px;
}

.create-card-form h2 {
  margin: 0;
}

label {
  display: grid;
  gap: 6px;
  font-size: 14px;
}

input,
select,
button {
  font: inherit;
}

input,
select {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 10px 12px;
  background: #fffdf9;
}

button {
  border: 0;
  border-radius: 999px;
  padding: 12px 16px;
  background: var(--accent);
  color: white;
  font-weight: 700;
  cursor: pointer;
}

.board-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}

.board-column {
  padding: 18px;
  min-height: 320px;
}

.column-body {
  display: grid;
  gap: 12px;
}

.card {
  padding: 14px;
  border-radius: 18px;
  border: 1px solid var(--accent-soft);
  background: linear-gradient(180deg, #fffdf9, #fff7f1);
}

.card-title {
  font-weight: 700;
  margin-bottom: 10px;
}

.card-meta {
  display: grid;
  gap: 4px;
  margin-bottom: 12px;
  color: #6a564a;
  font-size: 13px;
}

.move-label {
  font-size: 13px;
}

@media (max-width: 900px) {
  .hero,
  .board-grid {
    grid-template-columns: 1fr;
  }

  .hero h1 {
    font-size: 40px;
  }
}
""",
    "frontend/playwright.config.ts": """\
import { defineConfig } from '@playwright/test'

const baseURL = process.env.SELFTEST_BOARD_URL ?? 'http://127.0.0.1:4173'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL,
    headless: true,
  },
})
""",
    "frontend/e2e/board.spec.ts": """\
import { test, expect } from '@playwright/test'

test('create card captures assignee and due date, and column changes persist after reload', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Delivery Board' })).toBeVisible()

  await page.locator('#title-input').fill('Ship host-real matrix')
  await page.locator('#assignee-input').fill('royal')
  await page.locator('#due-date-input').fill('2026-05-10')
  await page.getByRole('button', { name: 'Create' }).click()

  const card = page.locator('.card').filter({ hasText: 'Ship host-real matrix' }).first()
  await expect(card).toContainText('royal')
  await expect(card).toContainText('2026-05-10')

  await card.locator('.move-card').selectOption('done')
  await page.reload()

  const doneColumn = page.locator('.board-column[data-column="done"]')
  await expect(doneColumn).toContainText('Ship host-real matrix')
})
""",
    "frontend/e2e/feature-create.spec.ts": """\
import { test, expect } from '@playwright/test'

test('create card flow exposes assignee and due date fields and renders the saved values', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Delivery Board' })).toBeVisible()

  await expect(page.locator('#assignee-input')).toBeVisible()
  await expect(page.locator('#due-date-input')).toBeVisible()

  await page.locator('#title-input').fill('Feature validator card')
  await page.locator('#assignee-input').fill('validator-owner')
  await page.locator('#due-date-input').fill('2026-05-12')
  await page.getByRole('button', { name: 'Create' }).click()

  const card = page.locator('.card').filter({ hasText: 'Feature validator card' }).first()
  await expect(card).toContainText('validator-owner')
  await expect(card).toContainText('2026-05-12')
})
""",
    "frontend/e2e/column-persist.spec.ts": """\
import { test, expect } from '@playwright/test'

test('moving an existing seed card persists after reload', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Delivery Board' })).toBeVisible()

  const card = page.locator('.card').filter({ hasText: 'Audit runtime packet flow' }).first()
  await card.locator('.move-card').selectOption('done')
  await page.reload()

  const doneColumn = page.locator('.board-column[data-column="done"]')
  await expect(doneColumn).toContainText('Audit runtime packet flow')
})
""",
    "scripts/api_smoke.py": """\
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request


API_BASE = os.environ.get('SELFTEST_API_BASE_URL', 'http://127.0.0.1:8011')


def _request(path: str, *, method: str = 'GET', payload: dict | None = None) -> tuple[int, dict]:
    body = None
    headers = {}
    if payload is not None:
      body = json.dumps(payload).encode('utf-8')
      headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(f'{API_BASE}{path}', data=body, headers=headers, method=method)
    try:
      with urllib.request.urlopen(request, timeout=10) as response:
        return response.status, json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
      payload = exc.read().decode('utf-8')
      try:
        decoded = json.loads(payload)
      except json.JSONDecodeError:
        decoded = {'detail': payload}
      return exc.code, decoded


def main() -> int:
    status, health = _request('/api/health')
    if status != 200 or not health.get('ok'):
        print('health check failed', file=sys.stderr)
        return 1

    status, created = _request(
        '/api/cards',
        method='POST',
        payload={
            'title': 'API validator card',
            'column': 'todo',
            'assignee': 'qa-owner',
            'due_date': '2026-05-11',
        },
    )
    if status != 201:
        print(f'create failed: status={status}', file=sys.stderr)
        return 1
    if created.get('assignee') != 'qa-owner' or created.get('due_date') != '2026-05-11':
        print('create did not persist assignee + due_date', file=sys.stderr)
        return 1

    status, updated = _request(
        f"/api/cards/{created['id']}",
        method='PATCH',
        payload={'title': ''},
    )
    if status < 400:
        print('empty title update unexpectedly succeeded', file=sys.stderr)
        return 1
    if updated.get('detail') in (None, ''):
        print('empty title update did not explain failure', file=sys.stderr)
        return 1

    print('API_SMOKE_OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
""",
    "scripts/validate_host_real.py": """\
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / 'frontend'
SHARED_CACHE = Path('/tmp/thoth-selftest-runtime/shared-cache')
API_BASE = os.environ.get('SELFTEST_API_BASE_URL', 'http://127.0.0.1:8011')
BOARD_URL = os.environ.get('SELFTEST_BOARD_URL', 'http://127.0.0.1:4173')


def _wait_for(url: str, description: str, timeout: float = 20) -> None:
    deadline = time.time() + timeout
    last_error = ''
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                if response.status < 500:
                    return
        except urllib.error.URLError as exc:
            last_error = str(exc)
        except Exception as exc:  # pragma: no cover - defensive
            last_error = str(exc)
        time.sleep(0.5)
    raise RuntimeError(f'timed out waiting for {description}: {last_error}')


def _stop_process(proc: subprocess.Popen[str] | None) -> None:
    if proc is None or proc.poll() is not None:
        return
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def _run(argv: list[str], *, cwd: Path, env: dict[str, str] | None = None) -> None:
    merged_env = dict(os.environ)
    if env:
        merged_env.update(env)
    completed = subprocess.run(argv, cwd=str(cwd), env=merged_env, text=True)
    if completed.returncode != 0:
        raise RuntimeError(f'command failed: {argv!r}')


def _playwright_browser_ready(playwright_browsers: Path) -> bool:
    return any(playwright_browsers.glob('chromium-*/chrome-linux64/chrome'))


def _clear_stale_playwright_lock(playwright_browsers: Path) -> None:
    if _playwright_browser_ready(playwright_browsers):
        return
    lock_dir = playwright_browsers / '__dirlock'
    if lock_dir.exists():
        for child in lock_dir.iterdir():
            if child.is_file() or child.is_symlink():
                child.unlink(missing_ok=True)
        lock_dir.rmdir()


def main() -> int:
    parser = argparse.ArgumentParser(description='Run one self-contained host-real validator.')
    parser.add_argument('--api-script', action='append', default=[])
    parser.add_argument('--spec', action='append', default=[])
    args = parser.parse_args()

    playwright_browsers = SHARED_CACHE / 'ms-playwright'
    npm_cache = SHARED_CACHE / 'npm-cache'
    xdg_cache = SHARED_CACHE / 'xdg-cache'
    playwright_browsers.mkdir(parents=True, exist_ok=True)
    npm_cache.mkdir(parents=True, exist_ok=True)
    xdg_cache.mkdir(parents=True, exist_ok=True)

    env = {
        'SELFTEST_API_BASE_URL': API_BASE,
        'SELFTEST_BOARD_URL': BOARD_URL,
        'PLAYWRIGHT_BROWSERS_PATH': str(playwright_browsers),
        'PLAYWRIGHT_SKIP_BROWSER_GC': '1',
        'NPM_CONFIG_CACHE': str(npm_cache),
        'npm_config_cache': str(npm_cache),
        'XDG_CACHE_HOME': str(xdg_cache),
    }
    backend_proc = None
    frontend_proc = None
    try:
        _run(['npm', 'ci', '--no-audit', '--no-fund'], cwd=FRONTEND, env=env)
        _run(['npm', 'run', 'build'], cwd=FRONTEND, env=env)
        if not _playwright_browser_ready(playwright_browsers):
            _clear_stale_playwright_lock(playwright_browsers)
            _run(['npx', 'playwright', 'install', 'chromium'], cwd=FRONTEND, env=env)

        backend_proc = subprocess.Popen(
            [sys.executable, '-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', '8011'],
            cwd=str(ROOT),
            text=True,
            start_new_session=True,
        )
        _wait_for(f'{API_BASE}/api/health', 'backend health')

        frontend_proc = subprocess.Popen(
            ['npx', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4173'],
            cwd=str(FRONTEND),
            text=True,
            start_new_session=True,
        )
        _wait_for(BOARD_URL, 'frontend preview')

        for script in args.api_script:
            _run([sys.executable, script], cwd=ROOT, env=env)
        for spec in args.spec:
            _run(['npx', 'playwright', 'test', spec], cwd=FRONTEND, env=env)
        print('HOST_REAL_VALIDATOR_OK')
        return 0
    finally:
        _stop_process(frontend_proc)
        _stop_process(backend_proc)


if __name__ == '__main__':
    raise SystemExit(main())
""",
}


def seed_host_real_app(project_dir: Path) -> None:
    """Write the disposable FastAPI + Vite board used by heavy selftest."""
    for relpath, content in SEED_FILES.items():
        target = project_dir / relpath
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
