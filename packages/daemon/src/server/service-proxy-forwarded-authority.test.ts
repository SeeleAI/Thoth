import http from "node:http";
import net from "node:net";
import express from "express";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import {
  createServiceProxySubsystem,
  findFreePort,
  type ServiceProxyRouteEntry,
} from "./service-proxy.js";

const logger = pino({ level: "silent" });

interface ForwardedFixture {
  daemonPort: number;
  route: ServiceProxyRouteEntry;
  close(): Promise<void>;
}

const fixtures: ForwardedFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

async function startFixture(options: {
  trustedProxies: true | string[];
  publicBaseUrl?: string;
}): Promise<ForwardedFixture> {
  const upstreamPort = await findFreePort();
  const upgradeSockets = new Set<net.Socket>();
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(req.headers));
  });
  upstream.on("upgrade", (req, socket) => {
    upgradeSockets.add(socket);
    socket.once("close", () => upgradeSockets.delete(socket));
    socket.on("error", () => socket.destroy());
    const body = JSON.stringify(req.headers);
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Echo-Length: ${body.length}\r\n\r\n${body}`,
    );
  });
  await new Promise<void>((resolve) => upstream.listen(upstreamPort, "127.0.0.1", resolve));

  const serviceProxy = createServiceProxySubsystem({
    logger,
    trustedProxies: options.trustedProxies,
    publicBaseUrl: options.publicBaseUrl,
  });
  const route = serviceProxy.registerWorkspaceService({
    workspaceId: "workspace-a",
    projectSlug: "repo",
    branchName: "main",
    scriptName: "api",
    port: upstreamPort,
    publicBaseUrl: options.publicBaseUrl,
  });

  const daemonPort = await findFreePort();
  const app = express();
  app.use(serviceProxy.middleware());
  app.use((_req, res) => res.status(404).send("404 Not Found"));
  const daemon = http.createServer(app);
  daemon.on("upgrade", serviceProxy.upgradeHandler({ passthroughUnknown: false }));
  await new Promise<void>((resolve) => daemon.listen(daemonPort, "127.0.0.1", resolve));

  let closed = false;
  const fixture: ForwardedFixture = {
    daemonPort,
    route,
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of upgradeSockets) socket.destroy();
      daemon.closeAllConnections();
      await new Promise<void>((resolve) => daemon.close(() => resolve()));
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    },
  };
  fixtures.push(fixture);
  return fixture;
}

function httpGet(
  port: number,
  host: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.get(
      { hostname: "127.0.0.1", port, path: "/", headers: { host, ...headers } },
      (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      },
    );
    request.on("error", reject);
  });
}

function upgradeThroughProxy(
  port: number,
  host: string,
  headers: Record<string, string>,
): Promise<Record<string, string | undefined>> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => {
      socket.write(
        [
          "GET /ws HTTP/1.1",
          `Host: ${host}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
          "",
          "",
        ].join("\r\n"),
      );
    });
    let raw = "";
    let settled = false;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    socket.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
      const separator = raw.indexOf("\r\n\r\n");
      if (separator === -1) return;
      const headerText = raw.slice(0, separator);
      const body = raw.slice(separator + 4);
      const length = /x-echo-length: (\d+)/i.exec(headerText);
      if (!length || body.length < Number(length[1])) return;
      settled = true;
      socket.destroy();
      resolve(JSON.parse(body.slice(0, Number(length[1]))) as Record<string, string | undefined>);
    });
    socket.once("error", finishError);
    socket.once("close", () => finishError(new Error("Upgrade closed before header echo")));
  });
}

function parseHeaders(response: {
  status: number;
  body: string;
}): Record<string, string | undefined> {
  expect(response.status).toBe(200);
  return JSON.parse(response.body) as Record<string, string | undefined>;
}

describe("service proxy forwarded authority", () => {
  test("ignores direct Host-derived forwarded spoofing and uses registered connection authority", async () => {
    const fixture = await startFixture({ trustedProxies: [] });
    const headers = parseHeaders(
      await httpGet(fixture.daemonPort, `${fixture.route.hostname}:${fixture.daemonPort}`, {
        "x-forwarded-host": "attacker.example:443",
        "x-forwarded-port": "443",
        "x-forwarded-proto": "https",
        "x-forwarded-for": "203.0.113.9",
      }),
    );

    expect(headers.host).toBe(`${fixture.route.hostname}:${fixture.daemonPort}`);
    expect(headers["x-forwarded-host"]).toBe(`${fixture.route.hostname}:${fixture.daemonPort}`);
    expect(headers["x-forwarded-port"]).toBe(String(fixture.daemonPort));
    expect(headers["x-forwarded-proto"]).toBe("http");
    expect(headers["x-forwarded-for"]).toBe("127.0.0.1");
  });

  test("accepts coherent authority only from a configured trusted proxy", async () => {
    const fixture = await startFixture({ trustedProxies: ["loopback"] });
    const headers = parseHeaders(
      await httpGet(fixture.daemonPort, fixture.route.hostname, {
        "x-forwarded-host": `${fixture.route.hostname}:8443`,
        "x-forwarded-port": "8443",
        "x-forwarded-proto": "https",
        "x-forwarded-for": "203.0.113.9",
      }),
    );

    expect(headers.host).toBe(`${fixture.route.hostname}:8443`);
    expect(headers["x-forwarded-host"]).toBe(`${fixture.route.hostname}:8443`);
    expect(headers["x-forwarded-port"]).toBe("8443");
    expect(headers["x-forwarded-proto"]).toBe("https");
    expect(headers["x-forwarded-for"]).toBe("203.0.113.9, 127.0.0.1");
  });

  test("rejects conflicting trusted forwarded host and port instead of mixing authorities", async () => {
    const fixture = await startFixture({ trustedProxies: ["loopback"] });
    const response = await httpGet(fixture.daemonPort, fixture.route.hostname, {
      "x-forwarded-host": `${fixture.route.hostname}:8443`,
      "x-forwarded-port": "9443",
      "x-forwarded-proto": "https",
    });

    expect(response.status).toBe(400);
    expect(response.body).toBe("400 Invalid forwarded authority");
  });

  test("rejects forwarded ports outside the TCP range", async () => {
    const fixture = await startFixture({ trustedProxies: ["loopback"] });
    const response = await httpGet(fixture.daemonPort, fixture.route.hostname, {
      "x-forwarded-host": fixture.route.hostname,
      "x-forwarded-port": "70000",
      "x-forwarded-proto": "https",
    });

    expect(response.status).toBe(400);
    expect(response.body).toBe("400 Invalid forwarded authority");
  });

  test("uses the configured publicBaseUrl port and protocol as one indivisible authority", async () => {
    const fixture = await startFixture({
      trustedProxies: ["loopback"],
      publicBaseUrl: "https://services.example.com:8443",
    });
    if (!fixture.route.publicHostname) throw new Error("Expected a public route hostname");
    const headers = parseHeaders(
      await httpGet(fixture.daemonPort, fixture.route.publicHostname, {
        "x-forwarded-host": `${fixture.route.publicHostname}:443`,
        "x-forwarded-port": "443",
        "x-forwarded-proto": "http",
      }),
    );

    expect(headers.host).toBe(`${fixture.route.publicHostname}:8443`);
    expect(headers["x-forwarded-host"]).toBe(`${fixture.route.publicHostname}:8443`);
    expect(headers["x-forwarded-port"]).toBe("8443");
    expect(headers["x-forwarded-proto"]).toBe("https");
  });

  test("uses exactly the same trusted host, port, proto, and for semantics for HTTP and WebSocket", async () => {
    const fixture = await startFixture({ trustedProxies: ["loopback"] });
    const incoming = {
      "x-forwarded-host": `${fixture.route.hostname}:8443`,
      "x-forwarded-port": "8443",
      "x-forwarded-proto": "https",
      "x-forwarded-for": "203.0.113.9",
    };
    const httpHeaders = parseHeaders(
      await httpGet(fixture.daemonPort, fixture.route.hostname, incoming),
    );
    const websocketHeaders = await upgradeThroughProxy(
      fixture.daemonPort,
      fixture.route.hostname,
      incoming,
    );

    for (const header of [
      "host",
      "x-forwarded-host",
      "x-forwarded-port",
      "x-forwarded-proto",
      "x-forwarded-for",
    ]) {
      expect(websocketHeaders[header]).toBe(httpHeaders[header]);
    }
  });
});
