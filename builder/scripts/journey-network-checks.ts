/**
 * Package J1 on package 0.6c's private networks: the checks the automated run (scripts/demo-journey.ts) makes on
 * what Docker listed of J1's project containers while the builder camera walked the journey (`docker ps`, every
 * second: each container's name, networks and published ports). Kept apart from the run so that a test can give it
 * made-up lists.
 */
/**
 * The checks on what Docker listed of J1's containers during the run (package 0.6c). `seen` holds each container's
 * networks and published ports as last sampled.
 */
export function networkChecks(seen: Map<string, { networks: string; ports: string }>): Array<{ name: string; ok: boolean; detail: string }> {
  const rows = [...seen.entries()].map(([name, v]) => ({ name, ...v }));
  const project = (name: string) => /^(builder_j1-[0-9a-f]{12})-/.exec(name)?.[1] ?? "?";
  const frontOnly = (r: { name: string; networks: string }) => r.networks === `${project(r.name)}_front`;
  const of = (re: RegExp) => rows.filter((r) => re.test(r.name));
  const cameras = of(/^builder_j1-[0-9a-f]{12}-app-camera-[0-9a-f]{6}$/);
  const runners = of(/^builder_j1-[0-9a-f]{12}-acceptance-/);
  const apps = of(/^builder_j1-[0-9a-f]{12}-app-\d+$/);
  const checkers = of(/^builder_j1-[0-9a-f]{12}-check-run-/);
  const onHost = rows.filter((r) => r.networks.split(",").includes("host"));
  const list = (rs: typeof rows) => rs.map((r) => `${r.name} [${r.networks}]${r.ports ? ` ports ${r.ports}` : ""}`).join("; ");
  return [
    { name: "no J1 container published a port on the machine (Docker's list, every second)", ok: rows.length > 0 && rows.every((r) => !r.ports.includes("->")), detail: list(rows.filter((r) => r.ports.includes("->"))) || `${rows.length} containers seen` },
    { name: "only the door's machine side (egress-host) was on the machine's network", ok: onHost.length > 0 && onHost.every((r) => /-egress-host-\d+$/.test(r.name)), detail: list(onHost) },
    { name: "the app camera ran on the project's front network alone", ok: cameras.length > 0 && cameras.every(frontOnly), detail: list(cameras) || "not seen" },
    { name: "the acceptance runner ran on the project's front network alone", ok: runners.length > 0 && runners.every(frontOnly), detail: list(runners) || "not seen" },
    { name: "the app was on the project's data and front networks alone", ok: apps.length > 0 && apps.every((r) => r.networks === `${project(r.name)}_data,${project(r.name)}_front`), detail: list(apps) || "not seen" },
    { name: "every check container seen (it asks the app before a start or a run) was on the front network alone", ok: checkers.every(frontOnly), detail: list(checkers) || "none seen (each lives under a second)" },
  ];
}


/**
 * Package J3: the checks on the live preview's containers in Docker's list: the live camera (the project's own
 * `acceptance` service, with the camera socket's folder mounted) and every stream (a `check` container, named
 * `<project>-live-<8 hex>`) on the project's front network alone, none publishing a port.
 */
export function liveNetworkChecks(seen: Map<string, { networks: string; ports: string }>): Array<{ name: string; ok: boolean; detail: string }> {
  const rows = [...seen.entries()].map(([name, v]) => ({ name, ...v }));
  const project = (name: string) => /^(builder_j1-[0-9a-f]{12})-/.exec(name)?.[1] ?? "?";
  const frontOnly = (r: { name: string; networks: string }) => r.networks === `${project(r.name)}_front`;
  const list = (rs: typeof rows) => rs.map((r) => `${r.name} [${r.networks}]${r.ports ? ` ports ${r.ports}` : ""}`).join("; ");
  const liveCameras = rows.filter((r) => /^builder_j1-[0-9a-f]{12}-live-camera-[0-9a-f]{6}$/.test(r.name));
  const streams = rows.filter((r) => /^builder_j1-[0-9a-f]{12}-live-[0-9a-f]{8}$/.test(r.name));
  return [
    { name: "the live camera ran on the project's front network alone", ok: liveCameras.length > 0 && liveCameras.every(frontOnly), detail: list(liveCameras) || "not seen" },
    { name: "every stream to the app (a check container) seen was on the project's front network alone, publishing no port", ok: streams.length > 0 && streams.every((r) => frontOnly(r) && !r.ports.includes("->")), detail: `${streams.length} seen: ${list(streams.slice(0, 6))}${streams.length > 6 ? "; ..." : ""}` },
  ];
}
