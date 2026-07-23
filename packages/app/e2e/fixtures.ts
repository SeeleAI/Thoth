import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { getE2EDaemonPort } from "./helpers/daemon-port";
import { buildCreateAgentPreferences, buildSeededHost } from "./helpers/daemon-registry";
import { createWithWorkspace, type WithWorkspace } from "./helpers/with-workspace";

// Test setup is wired through an `auto: true` fixture rather than `test.beforeEach`.
// `test.beforeEach` declared at the top level of a non-test fixture file is unreliable
// across spec-file boundaries — Playwright sometimes skips it for the first test of a
// subsequent spec when multiple specs run in the same worker. Auto fixtures run
// reliably for every test that uses this `test` object.
type NewIsolatedPage = (options: {
  viewport: { width: number; height: number };
  clientId?: string;
}) => Promise<Page>;

const test = base.extend<{
  thothE2ESetup: void;
  withWorkspace: WithWorkspace;
  newIsolatedPage: NewIsolatedPage;
}>({
  baseURL: async ({}, provide) => {
    if (process.env.E2E_BASE_URL) {
      await provide(process.env.E2E_BASE_URL);
      return;
    }
    const metroPort = process.env.E2E_METRO_PORT;
    if (!metroPort) {
      throw new Error("E2E_METRO_PORT not set - globalSetup must run first");
    }
    await provide(`http://localhost:${metroPort}`);
  },
  thothE2ESetup: [
    async ({ page }, provide, testInfo) => {
      const entries: string[] = [];

      page.on("console", (message) => {
        entries.push(`[console:${message.type()}] ${message.text()}`);
      });

      page.on("pageerror", (error) => {
        entries.push(`[pageerror] ${error.message}`);
      });
      await configureE2EPage(page);

      await provide();

      if (entries.length > 0 && testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("browser-console", {
          body: entries.join("\n"),
          contentType: "text/plain",
        });
      }
    },
    { auto: true },
  ],
  newIsolatedPage: async ({ browser, baseURL }, provide) => {
    const contexts: BrowserContext[] = [];
    await provide(async ({ viewport, clientId }) => {
      const context = await browser.newContext({ baseURL, viewport });
      contexts.push(context);
      const page = await context.newPage();
      await configureE2EPage(page, clientId);
      return page;
    });
    await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
  },
  withWorkspace: async ({ page }, provide) => {
    const handle = createWithWorkspace(page);
    await provide(handle.withWorkspace);
    await handle.cleanup();
  },
});

async function configureE2EPage(page: Page, clientId?: string): Promise<void> {
  const daemonPort = getE2EDaemonPort();
  const metroPort = process.env.E2E_METRO_PORT;
  if (!metroPort) {
    throw new Error(
      "E2E_METRO_PORT is not set. Ensure Playwright `globalSetup` starts Metro and exports E2E_METRO_PORT.",
    );
  }

  await page.route(/:(6767)\b/, (route) => route.abort());
  await page.routeWebSocket(/:(6767)\b/, async (ws) => {
    await ws.close({ code: 1008, reason: "Blocked connection to localhost:6767 during e2e." });
  });

  const seedNonce = Math.random().toString(36).slice(2);
  const serverId = process.env.E2E_SERVER_ID;
  if (!serverId) {
    throw new Error("E2E_SERVER_ID is not set - expected from Playwright globalSetup.");
  }
  const testDaemon = buildSeededHost({
    serverId,
    endpoint: `127.0.0.1:${daemonPort}`,
    nowIso: new Date().toISOString(),
  });
  const createAgentPreferences = buildCreateAgentPreferences(testDaemon.serverId);

  await page.addInitScript(
    ({ daemon, preferences, seedNonce: nonce, stableClientId }) => {
      const disableOnceKey = "@thoth:e2e-disable-default-seed-once";
      const disableValue = localStorage.getItem(disableOnceKey);
      if (disableValue) {
        localStorage.removeItem(disableOnceKey);
        if (disableValue === nonce) {
          return;
        }
      }

      localStorage.setItem("@thoth:e2e", "1");
      localStorage.setItem("@thoth:e2e-seed-nonce", nonce);
      localStorage.setItem("@thoth:daemon-registry", JSON.stringify([daemon]));
      localStorage.removeItem("@thoth:settings");
      localStorage.setItem("@thoth:create-agent-preferences", JSON.stringify(preferences));
      if (stableClientId) {
        localStorage.setItem("@thoth:client-id-v1", stableClientId);
      }
    },
    {
      daemon: testDaemon,
      preferences: createAgentPreferences,
      seedNonce,
      stableClientId: clientId,
    },
  );
}

export { test, expect, type Page };
