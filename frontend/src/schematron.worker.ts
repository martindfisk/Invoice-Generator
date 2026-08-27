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
export const SAXON_RUNTIME_URL = "/saxon/SaxonJS2.rt.js";
export const SEF_BASE = "/sef/";

export type SchematronRun = { ruleSet: string; svrl: string; loadMs: number; runMs: number };

type SaxonTransform = { principalResult: string };

type SaxonApi = {
  transform(
    options: { stylesheetInternal: unknown; sourceText: string; destination: "serialized" },
    mode: "async",
  ): Promise<SaxonTransform>;
};

type WorkerScope = { importScripts(...urls: string[]): void };

const sefCache = new Map<string, unknown>();
let runtime: Promise<SaxonApi> | undefined;

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

function sefUrl(ruleSet: string, base = SEF_BASE): string {
  return `${base}${ruleSet}.sef.json`;
}

async function loadSef(ruleSet: string, base = SEF_BASE): Promise<unknown> {
  const url = sefUrl(ruleSet, base);
  const cached = sefCache.get(url);
  if (cached) return cached;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `${url} is not available (${response.status} ${response.statusText}) - run "make sef"`,
    );
  }
  const parsed: unknown = await response.json();
  sefCache.set(url, parsed);
  return parsed;
}

export async function runSchematron(
  xml: string,
  ruleSets: string[],
  base = SEF_BASE,
): Promise<SchematronRun[]> {
  const engine = await loadRuntime();
  const runs: SchematronRun[] = [];
  for (const ruleSet of ruleSets) {
    const startedLoad = performance.now();
    const stylesheetInternal = await loadSef(ruleSet, base);
    const startedRun = performance.now();
    const result = await engine.transform(
      { stylesheetInternal, sourceText: xml, destination: "serialized" },
      "async",
    );
    runs.push({
      ruleSet,
      svrl: result.principalResult,
      loadMs: Math.round(startedRun - startedLoad),
      runMs: Math.round(performance.now() - startedRun),
    });
  }
  return runs;
}
