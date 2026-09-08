// Schematron engine: SaxonJS 2 executing the SEF built by `frontend/scripts/build-sef.mjs`.
//
// This was meant to be a Web Worker, and the loading strategy below is the one a worker would
// use (lazy `importScripts` of the runtime, `fetch` of the SEF, parsed SEF cached across runs
// because re-parsing one costs 110-165 ms). It runs on the main thread instead, because the
// SaxonJS 2.7 browser runtime cannot load in a worker: `SaxonJS2.rt.js` evaluates
// `abstractNode = Node` while loading and calls `new DOMParser()` to parse source text, and
// both globals are `[Exposed=Window]`. Verified in Chromium - `importScripts()` of the runtime
// inside a classic worker throws `ReferenceError: Node is not defined`. `loadRuntime()` still
// uses `importScripts` when it finds itself in a worker, so the day SaxonJS ships a DOM-free
// runtime (or a DOM shim is vendored) this module moves across unchanged.
import { SEF_BASE } from "./schematron-sets";

export const SAXON_RUNTIME_URL = "/saxon/SaxonJS2.rt.js";

export type SchematronRun = { ruleSet: string; svrl: string; loadMs: number; runMs: number };

// How a caller addresses one SEF: `url` is what is fetched, `key` identifies the *content*
// (the manifest's sha256 when known). The parsed-SEF cache is keyed on `key`, never on the
// URL — a rule set replaced on disk under the same filename used to be served stale for the
// rest of the session, silently, in a compliance tool. A plain string falls back to key = URL
// for environments without a manifest (same staleness window as before, but never worse).
export type SefRef = { id: string; url: string; key: string };

type SaxonTransform = { principalResult: string };

type SaxonApi = {
  transform(
    options: { stylesheetInternal: unknown; sourceText: string; destination: "serialized" },
    mode: "async",
  ): Promise<SaxonTransform>;
};

type WorkerScope = { importScripts(...urls: string[]): void };

// Parsed SEFs are big — the three largest ship as 4.9–8.2 MB of JSON each (see
// public/sef/SOURCES.md), several times that once parsed — so the cache is a small LRU:
// four entries hold the whole working set (peppol + cen for UBL, xrechnung, cen-cii) so a
// session that alternates formats never thrashes, while capping the worst case at roughly
// 25 MB of source JSON.
const SEF_CACHE_LIMIT = 4;
const sefCache = new Map<string, unknown>();
let runtime: Promise<SaxonApi> | undefined;

function recallSef(key: string): unknown {
  const hit = sefCache.get(key);
  if (hit !== undefined) {
    sefCache.delete(key);
    sefCache.set(key, hit);
  }
  return hit;
}

function rememberSef(key: string, parsed: unknown): void {
  sefCache.delete(key);
  sefCache.set(key, parsed);
  while (sefCache.size > SEF_CACHE_LIMIT) {
    const oldest = sefCache.keys().next().value;
    if (oldest === undefined) break;
    sefCache.delete(oldest);
  }
}

function saxon(): SaxonApi | undefined {
  return (globalThis as { SaxonJS?: SaxonApi }).SaxonJS;
}

function injectScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(
        new Error(
          `the SaxonJS runtime (${url}) could not be loaded - run "make sef" to copy it from ` +
            "vendor/saxon-js into frontend/public/saxon",
        ),
      );
    document.head.append(script);
  });
}

function loadRuntime(url = SAXON_RUNTIME_URL): Promise<SaxonApi> {
  runtime ??= (async () => {
    const present = saxon();
    if (present) return present;
    const scope = globalThis as unknown as Partial<WorkerScope>;
    if (typeof document === "undefined") {
      if (typeof scope.importScripts !== "function") {
        throw new Error("no way to load the SaxonJS runtime in this environment");
      }
      scope.importScripts(url);
    } else {
      await injectScript(url);
    }
    const loaded = saxon();
    if (!loaded) throw new Error(`${url} loaded but did not define SaxonJS`);
    return loaded;
  })();
  return runtime;
}

function toRef(ruleSet: string | SefRef, base: string): SefRef {
  if (typeof ruleSet !== "string") return ruleSet;
  const url = `${base}${ruleSet}.sef.json`;
  return { id: ruleSet, url, key: url };
}

async function loadSef(ref: SefRef): Promise<unknown> {
  const cached = recallSef(ref.key);
  if (cached) return cached;
  const response = await fetch(ref.url);
  if (!response.ok) {
    throw new Error(
      `${ref.url} is not available (${response.status} ${response.statusText}) - run "make sef"`,
    );
  }
  const parsed: unknown = await response.json();
  rememberSef(ref.key, parsed);
  return parsed;
}

// Load the runtime and fetch+parse the SEFs without transforming anything, so the first real
// validation skips the 400–700 ms cold start. Failures are deliberately not surfaced here —
// the actual run reports them with context.
export async function prewarmSchematron(
  ruleSets: (string | SefRef)[],
  base = SEF_BASE,
): Promise<void> {
  await loadRuntime();
  for (const ruleSet of ruleSets) await loadSef(toRef(ruleSet, base));
}

export async function runSchematron(
  xml: string,
  ruleSets: (string | SefRef)[],
  base = SEF_BASE,
): Promise<SchematronRun[]> {
  const engine = await loadRuntime();
  const runs: SchematronRun[] = [];
  for (const ruleSet of ruleSets) {
    const ref = toRef(ruleSet, base);
    const startedLoad = performance.now();
    const stylesheetInternal = await loadSef(ref);
    const startedRun = performance.now();
    const result = await engine.transform(
      { stylesheetInternal, sourceText: xml, destination: "serialized" },
      "async",
    );
    runs.push({
      ruleSet: ref.id,
      svrl: result.principalResult,
      loadMs: Math.round(startedRun - startedLoad),
      runMs: Math.round(performance.now() - startedRun),
    });
  }
  return runs;
}
