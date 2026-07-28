import { createRequire } from "node:module";
import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import type { ServiceProxyRouteEntry } from "./service-proxy.js";

export type TrustedProxiesConfig = true | string[];

export interface ForwardedAuthority {
  host: string;
  hostname: string;
  port: number;
  proto: "http" | "https";
  for: string;
  peerTrusted: boolean;
}

type TrustProxy = (address: string, hop?: number) => boolean;
type ProxyAddrModule = {
  compile(value: string | string[]): TrustProxy;
};

const require = createRequire(import.meta.url);
const proxyAddr = require("proxy-addr") as ProxyAddrModule;
const MAX_TCP_PORT = 65_535;

export class ForwardedAuthorityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForwardedAuthorityError";
  }
}

interface ParsedAuthority {
  hostname: string;
  port: number | null;
}

export class ForwardedAuthorityResolver {
  private readonly trustProxy: TrustProxy;

  constructor(trustedProxies: TrustedProxiesConfig = []) {
    this.trustProxy =
      trustedProxies === true ? () => true : proxyAddr.compile(trustedProxies.slice());
  }

  resolve(request: IncomingMessage, route: ServiceProxyRouteEntry): ForwardedAuthority {
    const peerAddress = request.socket.remoteAddress?.trim() || "127.0.0.1";
    const peerTrusted = this.trustProxy(peerAddress, 0);
    const requestAuthority = parseAuthority(request.headers.host ?? route.hostname, "Host");
    const matchedAuthority = this.matchRegisteredAuthority(requestAuthority, route, "Host");

    const forwardedHostValue = peerTrusted ? singleHeader(request, "x-forwarded-host") : null;
    const forwardedAuthority = forwardedHostValue
      ? this.matchRegisteredAuthority(
          parseAuthority(forwardedHostValue, "X-Forwarded-Host"),
          route,
          "X-Forwarded-Host",
        )
      : matchedAuthority;

    const publicAuthority =
      forwardedAuthority.kind === "public" && route.publicHostname && route.publicBaseUrl
        ? resolveConfiguredPublicAuthority(route.publicHostname, route.publicBaseUrl)
        : null;
    const proto = publicAuthority?.proto ?? this.resolveProtocol(request, peerTrusted);
    const port =
      publicAuthority?.port ??
      this.resolvePort({
        request,
        peerTrusted,
        proto,
        forwardedHostPort: forwardedHostValue ? forwardedAuthority.authority.port : null,
      });
    const hostname = publicAuthority?.hostname ?? forwardedAuthority.authority.hostname;
    const host = formatAuthority(hostname, port, proto, publicAuthority?.explicitPort ?? false);

    return {
      host,
      hostname,
      port,
      proto,
      for: resolveForwardedFor(request, peerAddress, peerTrusted),
      peerTrusted,
    };
  }

  private matchRegisteredAuthority(
    authority: ParsedAuthority,
    route: ServiceProxyRouteEntry,
    headerName: string,
  ): { kind: "local" | "public"; authority: ParsedAuthority } {
    if (authority.hostname === route.hostname.toLowerCase()) {
      return { kind: "local", authority };
    }
    if (route.publicHostname && authority.hostname === route.publicHostname.toLowerCase()) {
      return { kind: "public", authority };
    }
    throw new ForwardedAuthorityError(`${headerName} does not match the registered service route`);
  }

  private resolveProtocol(request: IncomingMessage, peerTrusted: boolean): "http" | "https" {
    if (peerTrusted) {
      const forwarded = singleHeader(request, "x-forwarded-proto");
      if (forwarded) {
        const normalized = forwarded.toLowerCase();
        if (normalized !== "http" && normalized !== "https") {
          throw new ForwardedAuthorityError("X-Forwarded-Proto must be http or https");
        }
        return normalized;
      }
    }
    return "encrypted" in request.socket && request.socket.encrypted ? "https" : "http";
  }

  private resolvePort(options: {
    request: IncomingMessage;
    peerTrusted: boolean;
    proto: "http" | "https";
    forwardedHostPort: number | null;
  }): number {
    const forwardedPort = options.peerTrusted
      ? parsePortHeader(singleHeader(options.request, "x-forwarded-port"))
      : null;
    if (
      options.forwardedHostPort !== null &&
      forwardedPort !== null &&
      options.forwardedHostPort !== forwardedPort
    ) {
      throw new ForwardedAuthorityError(
        "X-Forwarded-Host and X-Forwarded-Port describe different authorities",
      );
    }
    if (options.forwardedHostPort !== null) {
      return options.forwardedHostPort;
    }
    if (forwardedPort !== null) {
      return forwardedPort;
    }

    const hasTrustedForwardedAuthority =
      options.peerTrusted &&
      (singleHeader(options.request, "x-forwarded-host") !== null ||
        singleHeader(options.request, "x-forwarded-proto") !== null);
    if (hasTrustedForwardedAuthority) {
      return defaultPort(options.proto);
    }

    const localPort = options.request.socket.localPort;
    if (localPort !== undefined && isValidPort(localPort)) {
      return localPort;
    }
    return defaultPort(options.proto);
  }
}

function resolveConfiguredPublicAuthority(
  publicHostname: string,
  publicBaseUrl: string,
): {
  hostname: string;
  port: number;
  proto: "http" | "https";
  explicitPort: boolean;
} {
  const base = new URL(publicBaseUrl);
  const proto = base.protocol === "https:" ? "https" : base.protocol === "http:" ? "http" : null;
  if (!proto) {
    throw new ForwardedAuthorityError("publicBaseUrl must use http or https");
  }
  const port = base.port ? parsePort(base.port, "publicBaseUrl port") : defaultPort(proto);
  return {
    hostname: publicHostname.toLowerCase(),
    port,
    proto,
    explicitPort: base.port.length > 0,
  };
}

function parseAuthority(value: string, headerName: string): ParsedAuthority {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || /[\s,/@]/.test(trimmed)) {
    throw new ForwardedAuthorityError(`${headerName} contains an invalid authority`);
  }

  const bracketed = /^\[([^\]]+)](?::(\d+))?$/.exec(trimmed);
  if (bracketed) {
    if (isIP(bracketed[1]) !== 6) {
      throw new ForwardedAuthorityError(`${headerName} contains an invalid IPv6 authority`);
    }
    return {
      hostname: `[${bracketed[1]}]`,
      port: bracketed[2] ? parsePort(bracketed[2], `${headerName} port`) : null,
    };
  }

  const match = /^([^:]+?)(?::(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new ForwardedAuthorityError(`${headerName} contains an invalid authority`);
  }
  return {
    hostname: match[1],
    port: match[2] ? parsePort(match[2], `${headerName} port`) : null,
  };
}

function parsePortHeader(value: string | null): number | null {
  return value === null ? null : parsePort(value, "X-Forwarded-Port");
}

function parsePort(value: string, label: string): number {
  if (!/^\d+$/.test(value)) {
    throw new ForwardedAuthorityError(`${label} must be an integer`);
  }
  const port = Number(value);
  if (!isValidPort(port)) {
    throw new ForwardedAuthorityError(`${label} must be between 1 and ${MAX_TCP_PORT}`);
  }
  return port;
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= MAX_TCP_PORT;
}

function singleHeader(request: IncomingMessage, name: string): string | null {
  const raw = request.headers[name];
  if (raw === undefined) return null;
  if (Array.isArray(raw)) {
    if (raw.length !== 1) {
      throw new ForwardedAuthorityError(`${name} must contain exactly one value`);
    }
    return requireSingleHeaderValue(raw[0], name);
  }
  return requireSingleHeaderValue(raw, name);
}

function requireSingleHeaderValue(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes(",")) {
    throw new ForwardedAuthorityError(`${name} must contain exactly one non-empty value`);
  }
  return trimmed;
}

function resolveForwardedFor(
  request: IncomingMessage,
  peerAddress: string,
  peerTrusted: boolean,
): string {
  if (!peerTrusted) return peerAddress;
  const raw = request.headers["x-forwarded-for"];
  if (raw === undefined) return peerAddress;
  const joined = Array.isArray(raw) ? raw.join(",") : raw;
  const addresses = joined
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  if (addresses.length === 0 || addresses.some((address) => isIP(address) === 0)) {
    throw new ForwardedAuthorityError("X-Forwarded-For must contain only IP addresses");
  }
  if (addresses.at(-1) !== peerAddress) {
    addresses.push(peerAddress);
  }
  return addresses.join(", ");
}

function formatAuthority(
  hostname: string,
  port: number,
  proto: "http" | "https",
  preserveExplicitPort: boolean,
): string {
  return preserveExplicitPort || port !== defaultPort(proto) ? `${hostname}:${port}` : hostname;
}

function defaultPort(proto: "http" | "https"): number {
  return proto === "https" ? 443 : 80;
}
