import { checkModel } from "./model-rules";
import { listPresets, preset, type PresetMeta } from "./presets";
import { store, useStore } from "./store";
import { useIsWide } from "./use-media";

const COUNTRY_ORDER = ["DE", "IT", "BE"];

const COUNTRY_NAMES: Record<string, string> = {
  DE: "Germany",
  IT: "Italy",
  BE: "Belgium",
};

const AUDIENCE_ORDER = ["B2C", "B2B", "B2G"];

const AUDIENCE_HINTS: Record<string, string> = {
  B2C: "to a consumer",
  B2B: "to a business",
  B2G: "to a public body",
};

// A matrix makes a defective preset easy to pick by accident, so it has to be marked without a
// hardcoded list: every sound preset passes the EN 16931 model rules, and the ones that do not
// exist to fail. Defects the model tier cannot see are caught by how the preset describes itself.
const DEFECTIVE = /\bbroken\b|\bdeliberate(ly)?\b|\bintentional(ly)?\b/i;

const defects = new Map<string, boolean>();

function failsModelRules(meta: PresetMeta): boolean {
  try {
    return checkModel(preset(meta.id)).length > 0;
  } catch {
    // A preset that cannot be built at all is a bug, not a deliberate defect — say nothing.
    return false;
  }
}

function isDefective(meta: PresetMeta): boolean {
  const known = defects.get(meta.id);
  if (known !== undefined) return known;
  const flagged =
    [meta.id, meta.label, meta.group, meta.summary].some((text) => DEFECTIVE.test(text)) ||
    failsModelRules(meta);
  defects.set(meta.id, flagged);
  return flagged;
}

function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function rowsOf(presets: PresetMeta[]): string[] {
  const present = unique(presets.map((meta) => meta.country));
  return [
    ...COUNTRY_ORDER.filter((code) => present.includes(code)),
    ...present.filter((code) => !COUNTRY_ORDER.includes(code)),
  ];
}

function columnsOf(presets: PresetMeta[]): string[] {
  const present = unique(presets.map((meta) => meta.audience));
  return [...AUDIENCE_ORDER, ...present.filter((code) => !AUDIENCE_ORDER.includes(code))];
}

function cellOf(presets: PresetMeta[], country: string, audience: string): PresetMeta[] {
  return presets.filter((meta) => meta.country === country && meta.audience === audience);
}

function tooltip(meta: PresetMeta): string {
  return `${meta.summary}\n\n${meta.formatLabel}\n${meta.legalBasis}\n${meta.group}`;
}

function Chip({ children }: { children: string }) {
  return (
    <span className="rounded-m border border-line px-1.5 py-0.5 text-[11px] text-muted">
      {children}
    </span>
  );
}

function DefectChip() {
  return (
    <span className="rounded-m border border-warning bg-warning-soft px-1.5 py-0.5 text-[11px] font-medium text-warning-ink">
      <span aria-hidden="true">▲ </span>broken on purpose
    </span>
  );
}

function PresetCard({
  meta,
  chosen,
  showAudience,
}: {
  meta: PresetMeta;
  chosen: boolean;
  showAudience: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={chosen}
      data-preset={meta.id}
      title={tooltip(meta)}
      onClick={() => store.dispatch({ type: "choosePreset", presetId: meta.id })}
      className={`flex h-full w-full flex-col gap-1 rounded-l border-2 bg-surface p-3 text-left shadow-s transition-colors ${
        chosen ? "border-brand bg-select-bg" : "border-line hover:border-brand"
      }`}
    >
      <span className="text-sm font-semibold text-ink">{meta.label}</span>
      <span className="flex flex-wrap items-center gap-1.5">
        {showAudience && <Chip>{meta.audience}</Chip>}
        <Chip>{meta.channel}</Chip>
        <Chip>{meta.group}</Chip>
        {isDefective(meta) && <DefectChip />}
      </span>
      <span className="line-clamp-1 text-xs text-muted">{meta.summary}</span>
    </button>
  );
}

function Cell({ presets, presetId }: { presets: PresetMeta[]; presetId: string | null }) {
  if (presets.length === 0) {
    return (
      <p className="rounded-l border border-dashed border-line px-3 py-4 text-center text-xs text-muted">
        No preset
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {presets.map((meta) => (
        <PresetCard key={meta.id} meta={meta} chosen={meta.id === presetId} showAudience={false} />
      ))}
    </div>
  );
}

function Matrix({ presets, presetId }: { presets: PresetMeta[]; presetId: string | null }) {
  const rows = rowsOf(presets);
  const columns = columnsOf(presets);

  return (
    <table className="w-full table-fixed border-separate border-spacing-2 text-left">
      <caption className="sr-only">Presets by country and audience</caption>
      <thead>
        <tr>
          <td className="w-40" />
          {columns.map((audience) => (
            <th
              key={audience}
              scope="col"
              className="sticky -top-4 z-10 bg-canvas pt-4 pb-1 align-bottom"
            >
              <span className="block text-sm font-semibold text-ink">{audience}</span>
              {AUDIENCE_HINTS[audience] && (
                <span className="block text-[11px] font-normal text-muted">
                  {AUDIENCE_HINTS[audience]}
                </span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((country) => (
          <tr key={country}>
            <th scope="row" className="w-40 align-top">
              <span className="block text-sm font-semibold text-ink">{countryName(country)}</span>
              <span className="block font-mono text-[11px] font-normal text-muted">{country}</span>
            </th>
            {columns.map((audience) => (
              <td key={audience} data-cell={`${country}:${audience}`} className="align-top">
                <Cell presets={cellOf(presets, country, audience)} presetId={presetId} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CountryList({ presets, presetId }: { presets: PresetMeta[]; presetId: string | null }) {
  const rows = rowsOf(presets);
  const columns = columnsOf(presets);

  return (
    <>
      {rows.map((country) => (
        <section
          key={country}
          aria-label={countryName(country)}
          data-country={country}
          className="flex flex-col gap-2"
        >
          <h3 className="text-[11px] font-bold tracking-wide text-muted uppercase">
            {countryName(country)}
          </h3>
          <div className="grid gap-2 @2xl:grid-cols-2">
            {columns
              .flatMap((audience) => cellOf(presets, country, audience))
              .map((meta) => (
                <PresetCard key={meta.id} meta={meta} chosen={meta.id === presetId} showAudience />
              ))}
          </div>
        </section>
      ))}
    </>
  );
}

export function StepSetup() {
  const presetId = useStore((state) => state.workflow.presetId);
  const transmitted = useStore((state) => state.workflow.send.outcome === "transmitted");
  const wide = useIsWide("(min-width: 1024px)");
  const presets = listPresets();

  return (
    <section
      aria-label="Preset picker"
      className="@container flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4"
    >
      <p className="text-sm text-muted">
        Pick a scenario to start — by country, and by who the invoice goes to. Every later step
        works on the invoice it loads; you can come back and switch at any time. The format and the
        legal basis of the chosen scenario are shown in the Mapper.
      </p>
      {transmitted && (
        <p
          role="status"
          className="rounded-l border border-success bg-brand-soft px-3 py-2 text-xs text-brand-ink"
        >
          Last invoice transmitted. Pick any scenario to start the next one — re-picking the
          highlighted card resumes what you just sent, diff and all.
        </p>
      )}
      {presetId && (
        <p className="flex flex-wrap items-center gap-2 rounded-l border border-line bg-surface px-3 py-2 text-xs text-muted">
          Clicking the chosen preset again keeps your work and returns to the Mapper.
          <button
            type="button"
            onClick={() => store.dispatch({ type: "choosePreset", presetId, fresh: true })}
            className="rounded-m border border-line px-2 py-0.5 font-medium text-muted hover:border-warning hover:text-warning-ink"
          >
            Reset preset
          </button>
          starts the scenario fresh (clears edits, validation and the send result).
        </p>
      )}
      {presets.length === 0 ? (
        <p role="status" className="text-sm text-muted">
          No presets are registered in <span className="font-mono">presets.ts</span>.
        </p>
      ) : wide ? (
        <Matrix presets={presets} presetId={presetId} />
      ) : (
        <CountryList presets={presets} presetId={presetId} />
      )}
    </section>
  );
}
