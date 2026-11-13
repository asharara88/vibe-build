// Types for the isolation probe (isolation-probe.mjs), so that the unit tests can call its pure
// functions with type checks. The probe itself is plain JavaScript: it runs inside containers with
// nothing but Node.

export interface ProbeSettings {
  sessionProxy: { host: string; port: number } | null;
  projectDbPort: number;
  egressPort: number;
  gatewayPort: number;
  builderDbPort: number;
  exampleAddress: string;
  /** True once the probe looked example.com's address up itself; false while it is only the address given. */
  exampleAddressLookedUp: boolean;
  timeoutMs: number;
  /** The gateway address of Docker's default network, read on the machine; null for no G attempts. */
  bridgeGateway: string | null;
  /** The machine's listening TCP sockets, read on the machine. */
  machineListeners: { address: string; port: number }[];
  /** Every address the machine holds, read on the machine (group M; package 0.6c). */
  machineAddresses: string[];
  /** Where the project's egress proxy is: a service name, or 127.0.0.1 (the default). */
  egressHost: string;
  /** The door's gateway port (attempt W1), or null. */
  gatewayVia: { host: string; port: number } | null;
  /** The project's own services by name (group P). */
  peers: { host: string; port: number }[];
}

export type Toward = "outside" | "host" | "lookup" | "egress-proxy" | "session-proxy" | "gateway" | "project";

export interface PlannedAttempt {
  id: string;
  group: string;
  toward: Toward;
  what: string;
  target: string;
  how: string;
  op: { type: "tcp" | "http" | "https" | "http-proxy" | "connect" | "https-tunnel" | "lookup" | "resolve"; [k: string]: unknown };
}

export const SESSION_CERT_PATHS: string[];
export const BODY_READ_MS: number;
export const OPENED_THEN_SILENT: string;
export const MAX_MACHINE_LISTENERS: number;
export const MAX_MACHINE_ADDRESSES: number;
export const ROUTES_INFO: string;
export const DEFAULT_ROUTE_INFO: string;
export const IPV6_INFO: string;
export function parseRoutes(text: string | undefined): string[];
export function ipv6State(text: string | null): string;
export const INTERFACES_UP: string;
export const INTERFACES_ALL: string;
export function listInterfaces(dir?: string): string;
export const GROUPS: Record<"A" | "B" | "C" | "D" | "E" | "F" | "G" | "M" | "P" | "W", string>;
export function parseSettings(text: string | undefined): ProbeSettings;
export function classifyError(code: string, context?: "connection" | "lookup"): string;
export function parseListeners(text: string | undefined, family?: 4 | 6): { address: string; port: number }[];
export function parseUdpBound(text: string | undefined, family?: 4 | 6): { address: string; port: number }[];
export function parseAbstractUnix(text: string | undefined): string[];
export function countOtherSockets(text: string | undefined): number;
export function planAttempts(s: ProbeSettings, extraListeners?: { address: string; port: number }[]): PlannedAttempt[];
export function runAttempt(a: PlannedAttempt, s: ProbeSettings, sessionCert: string | null): Promise<{ result: string; code: string | null; detail: string }>;
