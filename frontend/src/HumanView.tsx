import {
  memo,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";
import { format as toFixed } from "./decimal";
import { Field, SeverityGlyph } from "./Field";
import {
  catalogEntry,
  formatCarries,
  invoiceGroups,
  resolveField,
  rowCount,
  type FieldSpec,
  type GroupSpec,
} from "./field-registry";
import type { FormatPlugin } from "./formats";
import { getField, type FieldId, type FormatId, type Invoice } from "./model";
import { store, useStore } from "./store";
import type { Finding, Severity } from "./validation";
import type { Selection } from "./workflow";
import type { FieldEntry, FieldIndex } from "./xml-locate";

const LOCALES: Record<string, string> = {
  IT: "it-IT",
  BE: "nl-BE",
  FR: "fr-FR",
  DE: "de-DE",
  ES: "es-ES",
  NL: "nl-NL",
  AT: "de-AT",
};

const TYPE_CODES: Record<string, string> = {
  "380": "Commercial invoice",
  "381": "Credit note",
};

const DISCLAIMER = "Visualisation for review — the XML is the legally valid invoice.";

const EDIT_HINT =
  "Every field the invoice model can carry is listed, set or not — click a value to edit it, " +
  "then press Enter to apply or Escape to cancel.";

const RANK: Record<Severity, number> = { fatal: 0, error: 1, warning: 2, info: 3 };

const MONO_LEAVES = new Set([
  "bic",
  "buyerReference",
  "contract",
  "email",
  "iban",
  "id",
  "invoicedObject",
  "number",
  "phone",
  "postCode",
  "project",
  "purchaseOrder",
  "salesOrder",
  "scheme",
  "taxId",
  "tenderOrLot",
  "vatId",
]);

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string): Intl.NumberFormat {
  const cached = numberFormats.get(locale);
  if (cached) return cached;
  const created = new Intl.NumberFormat(locale);
  numberFormats.set(locale, created);
  return created;
}

function separators(locale: string): { group: string; decimal: string } {
  const parts = numberFormat(locale).formatToParts(11111.1);
  return {
    group: parts.find((part) => part.type === "group")?.value ?? ",",
    decimal: parts.find((part) => part.type === "decimal")?.value ?? ".",
  };
}

function localiseDecimal(value: string, digits: number, locale: string): string {
  let fixed: string;
  try {
    fixed = toFixed(value, digits);
  } catch {
    return value;
  }
  const negative = fixed.startsWith("-");
  const [whole, fraction = ""] = fixed.replace("-", "").split(".");
  const { group, decimal } = separators(locale);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const body = digits === 0 ? grouped : `${grouped}${decimal}${fraction}`;
  return negative ? `-${body}` : body;
}

function localeFor(country: string | undefined): string {
  return (country && LOCALES[country]) ?? "en-GB";
}

function currencySymbol(currency: string, locale: string): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

function money(value: string, currency: string, locale: string): string {
  return `${localiseDecimal(value, 2, locale)} ${currencySymbol(currency, locale)}`.trim();
}

function percent(value: string, locale: string): string {
  return `${localiseDecimal(value, 2, locale)} %`;
}

function day(value: string, locale: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!parts) return value;
  const date = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function leafOf(field: FieldId): string {
  return field.slice(field.lastIndexOf(".") + 1);
}

function rawValue(invoice: Invoice, field: FieldId): string {
  const value = getField(invoice, field);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function isMono(spec: FieldSpec): boolean {
  if (spec.kind !== "text" && spec.kind !== "longtext") return true;
  return MONO_LEAVES.has(leafOf(spec.field));
}

function displayValue(spec: FieldSpec, value: string, invoice: Invoice, locale: string): string {
  if (value === "") return "";
  if (spec.kind === "date") return day(value, locale);
  if (spec.kind === "code") {
    const text = spec.field === "typeCode" ? TYPE_CODES[value] : undefined;
    return text ? `${value} — ${text}` : value;
  }
  if (spec.kind !== "decimal") return value;
  const leaf = leafOf(spec.field);
  if (leaf === "rate") return percent(value, locale);
  if (leaf === "quantity") return localiseDecimal(value, 2, locale);
  return money(value, invoice.currency, locale);
}

function shortFormatName(label: string): string {
  return label.replace(/\s*\(.*$/, "").trim();
}

function caveatHint(spec: FieldSpec, formatLabel: string): string {
  const entry = spec.bt ? catalogEntry(spec.bt) : undefined;
  const head = entry
    ? `${spec.bt} ${entry.name} — ${entry.description}`
    : (spec.hint ?? spec.label);
  return `${head} · ${formatLabel} has no mapping row for this field, so a value here is not written to the XML.`;
}

type Counts = { set: number; total: number };

function countAt(invoice: Invoice, group: GroupSpec, index: number): Counts {
  let set = 0;
  let total = group.fields.length;
  for (const spec of group.fields) {
    if (rawValue(invoice, resolveField(spec.field, index)) !== "") set += 1;
  }
  for (const sub of group.subgroups ?? []) {
    const nested = countGroup(invoice, sub, index);
    set += nested.set;
    total += nested.total;
  }
  return { set, total };
}

function countGroup(invoice: Invoice, group: GroupSpec, index: number): Counts {
  if (!group.repeatable) return countAt(invoice, group, index);
  let set = 0;
  let total = 0;
  for (let row = 0; row < rowCount(invoice, group); row += 1) {
    const counted = countAt(invoice, group, row);
    set += counted.set;
    total += counted.total;
  }
  return { set, total };
}

// `rows` is false for one row of a repeatable group, which walks that row alone.
function eachField(
  invoice: Invoice,
  group: GroupSpec,
  index: number,
  rows: boolean,
  visit: (field: FieldId) => boolean,
): boolean {
  const indices = group.repeatable && rows ? [...Array(rowCount(invoice, group)).keys()] : [index];
  for (const row of indices) {
    for (const spec of group.fields) {
      if (visit(resolveField(spec.field, row))) return true;
    }
    for (const sub of group.subgroups ?? []) {
      if (eachField(invoice, sub, row, true, visit)) return true;
    }
  }
  return false;
}

function holdsField(
  invoice: Invoice,
  group: GroupSpec,
  index: number,
  rows: boolean,
  field: FieldId,
): boolean {
  return eachField(invoice, group, index, rows, (candidate) => candidate === field);
}

function groupFindings(
  invoice: Invoice,
  group: GroupSpec,
  index: number,
  rows: boolean,
  findings: Map<FieldId, Finding>,
): { worst: Finding; count: number } | undefined {
  if (findings.size === 0) return undefined;
  let worst: Finding | undefined;
  let count = 0;
  eachField(invoice, group, index, rows, (field) => {
    const finding = findings.get(field);
    if (!finding) return false;
    count += 1;
    if (!worst || RANK[finding.severity] < RANK[worst.severity]) worst = finding;
    return false;
  });
  return worst ? { worst, count } : undefined;
}

function rowSummary(invoice: Invoice, group: GroupSpec, index: number): string {
  const held = group.fields
    .map((spec) => ({ spec, value: rawValue(invoice, resolveField(spec.field, index)) }))
    .filter((candidate) => candidate.value !== "");
  const named = held.find((candidate) => leafOf(candidate.spec.field) === "name");
  if (named) return named.value;
  return held
    .slice(0, 2)
    .map((candidate) => candidate.value)
    .join(" · ");
}

function useRoving(count: number) {
  const [active, setActive] = useState(0);
  const items = useRef<(HTMLElement | null)[]>([]);
  const current = Math.min(active, Math.max(count - 1, 0));

  const steps: Record<string, (position: number) => number> = {
    ArrowDown: (position) => position + 1,
    ArrowRight: (position) => position + 1,
    ArrowUp: (position) => position - 1,
    ArrowLeft: (position) => position - 1,
    Home: () => 0,
    End: () => count - 1,
  };

  return (position: number) => ({
    tabIndex: position === current ? 0 : -1,
    ref: ((node: HTMLElement | null) => {
      items.current[position] = node;
    }) as Ref<HTMLButtonElement>,
    onFocus: () => setActive(position),
    onKeyDown: (event: KeyboardEvent) => {
      const step = steps[event.key];
      if (!step) return;
      event.preventDefault();
      const next = Math.max(0, Math.min(count - 1, step(position)));
      setActive(next);
      items.current[next]?.focus();
    },
  });
}

export type EditContext = {
  findings: Map<FieldId, Finding>;
  onEdit: (field: FieldId) => void;
  onCommit: (field: FieldId, value: string) => void;
  onCancelEdit: () => void;
};

type FieldListProps = {
  group: GroupSpec;
  index: number;
  invoice: Invoice;
  fields: FieldIndex;
  locale: string;
  formatId: FormatId;
  formatName: string;
  formatLabel: string;
  showUncarried: boolean;
  selectedField: FieldId | undefined;
  editingField: FieldId | undefined;
  findings: Map<FieldId, Finding>;
  followSelection: boolean;
  onSelect: (entry: FieldEntry) => void;
  edit: EditContext;
};

const FieldList = memo(function FieldList({
  group,
  index,
  invoice,
  fields,
  locale,
  formatId,
  formatName,
  formatLabel,
  showUncarried,
  selectedField,
  editingField,
  findings,
  followSelection,
  onSelect,
  edit,
}: FieldListProps) {
  const specs = useMemo(
    () =>
      group.fields.map((spec) => {
        const field = resolveField(spec.field, index);
        const value = rawValue(invoice, field);
        return {
          spec,
          field,
          value,
          display: displayValue(spec, value, invoice, locale),
          carried: formatCarries(formatId, field),
        };
      }),
    [group, index, invoice, locale, formatId],
  );

  const shown = showUncarried ? specs : specs.filter((candidate) => candidate.carried);
  const roving = useRoving(shown.length);

  if (shown.length === 0) {
    return group.fields.length === 0 ? null : (
      <p className="px-2 py-1.5 text-[11px] text-muted">
        {group.fields.length} field{group.fields.length === 1 ? "" : "s"} hidden — {formatName}{" "}
        cannot carry {group.fields.length === 1 ? "it" : "them"}.
      </p>
    );
  }

  return (
    <div className="grid gap-0.5 p-1.5 @2xl:grid-cols-2">
      {shown.map((candidate, position) => (
        <Field
          key={candidate.field}
          entry={fields.entry(candidate.field)}
          label={candidate.spec.label}
          value={candidate.display}
          mono={isMono(candidate.spec)}
          truncate={leafOf(candidate.spec.field) === "iban" ? "mid" : undefined}
          uapi={candidate.field.startsWith("buyer.channel.")}
          caveat={
            candidate.carried
              ? undefined
              : `${candidate.spec.bt ? `${candidate.spec.bt} · ` : ""}not carried by ${formatName}`
          }
          caveatHint={candidate.carried ? undefined : caveatHint(candidate.spec, formatLabel)}
          selected={selectedField === candidate.field}
          scrollIntoView={followSelection}
          editable={candidate.value}
          editing={editingField === candidate.field}
          finding={findings.get(candidate.field)}
          onSelect={onSelect}
          onEdit={() => edit.onEdit(candidate.field)}
          onCommit={(value) => edit.onCommit(candidate.field, value)}
          onCancelEdit={edit.onCancelEdit}
          {...roving(position)}
        />
      ))}
    </div>
  );
});

type SharedProps = {
  invoice: Invoice;
  fields: FieldIndex;
  locale: string;
  formatId: FormatId;
  formatName: string;
  formatLabel: string;
  showUncarried: boolean;
  selection: Selection;
  editing: FieldId | null;
  followSelection: boolean;
  open: Record<string, boolean>;
  onToggle: (key: string, open: boolean) => void;
  onSelect: (entry: FieldEntry) => void;
  edit: EditContext;
};

type GroupSectionProps = SharedProps & {
  group: GroupSpec;
  index: number;
  keyPath: string;
  depth: number;
  parentTitle?: string;
  asRow?: boolean;
};

const GroupSection = memo(function GroupSection(props: GroupSectionProps) {
  const { group, index, keyPath, depth, parentTitle, asRow, ...shared } = props;
  const { invoice, selection, editing, open, onToggle, edit } = shared;
  const panelId = useId();

  const repeats = Boolean(group.repeatable) && !asRow;
  const rows = group.repeatable ? rowCount(invoice, group) : 0;
  const counts = asRow ? countAt(invoice, group, index) : countGroup(invoice, group, index);
  const flagged = groupFindings(invoice, group, index, !asRow, edit.findings);

  const ownIds = useMemo(
    () => group.fields.map((spec) => resolveField(spec.field, index)),
    [group, index],
  );
  const owns = (field: FieldId | null | undefined) => field != null && ownIds.includes(field);

  // A selection made in the other pane (XML, findings) reveals its group; a click in this
  // pane must not, or the user could never collapse the group they are working in. A group the
  // user collapses while a selection sits inside stays collapsed for that selection — otherwise
  // the chevron would be inert until the selection moves — and a new selection reveals it again.
  const [revealDismissedFor, setRevealDismissedFor] = useState<FieldId | null>(null);
  const revealed =
    shared.followSelection &&
    selection?.field !== undefined &&
    selection.field !== revealDismissedFor &&
    holdsField(invoice, group, index, !asRow, selection.field);
  const fallback = repeats ? rows > 0 && counts.set > 0 : counts.set > 0;
  const isOpen = (open[keyPath] ?? fallback) || revealed;

  const title = group.title;
  const label = asRow ? `${title} ${index + 1}` : parentTitle ? `${parentTitle} · ${title}` : title;
  const summary = asRow ? rowSummary(invoice, group, index) : "";
  const tally = repeats
    ? `${rows} ${rows === 1 ? "row" : "rows"}`
    : `${counts.set} of ${counts.total} set`;
  const spoken = [
    asRow ? label : `${group.bg} · ${title} · ${group.cardinality}`,
    asRow && summary ? summary : undefined,
    tally,
    flagged ? `${flagged.count} finding${flagged.count === 1 ? "" : "s"}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  const head = depth === 0 ? "bg-surface-raised text-[11px] py-1.5" : "bg-surface text-[10px] py-1";
  const frame =
    depth === 0
      ? "shrink-0 overflow-hidden rounded-l border border-line bg-surface"
      : "border-t border-line";

  return (
    <section aria-label={label} className={frame}>
      <h3 className={`${head} font-bold tracking-wide text-muted uppercase`}>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          aria-label={spoken}
          onClick={() => {
            if (isOpen && revealed) setRevealDismissedFor(selection?.field ?? null);
            onToggle(keyPath, !isOpen);
          }}
          className="flex w-full items-center gap-1.5 px-3 text-left hover:text-ink"
        >
          <span aria-hidden="true" className="w-2 shrink-0">
            {isOpen ? "▾" : "▸"}
          </span>
          {asRow ? (
            <span className="min-w-0 truncate normal-case">
              <span className="font-mono">#{index + 1}</span>
              {summary && <span className="ml-1.5 font-normal text-ink">{summary}</span>}
            </span>
          ) : (
            <>
              <span className="shrink-0 font-mono normal-case">{group.bg}</span>
              <span aria-hidden="true">·</span>
              <span className="min-w-0 truncate">{title}</span>
              <span aria-hidden="true">·</span>
              <span className="shrink-0 font-mono font-normal normal-case">
                {group.cardinality}
              </span>
            </>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1 font-normal normal-case">
            {flagged && (
              <span title={`${flagged.count} finding${flagged.count === 1 ? "" : "s"}`}>
                <SeverityGlyph finding={flagged.worst} />
                {flagged.count}
              </span>
            )}
            <span className="tabular-nums">{tally}</span>
          </span>
        </button>
      </h3>
      <div id={panelId} hidden={!isOpen} className={depth > 0 ? "pl-3" : undefined}>
        {isOpen &&
          (repeats ? (
            rows === 0 ? (
              <p className="px-3 py-1.5 text-[11px] text-muted">
                No rows — this invoice carries none.
              </p>
            ) : (
              [...Array(rows).keys()].map((row) => (
                <GroupSection
                  {...shared}
                  key={row}
                  group={group}
                  index={row}
                  keyPath={`${keyPath}#${row}`}
                  depth={depth + 1}
                  parentTitle={title}
                  asRow
                />
              ))
            )
          ) : (
            <>
              <FieldList
                group={group}
                index={index}
                invoice={invoice}
                fields={shared.fields}
                locale={shared.locale}
                formatId={shared.formatId}
                formatName={shared.formatName}
                formatLabel={shared.formatLabel}
                showUncarried={shared.showUncarried}
                selectedField={owns(selection?.field) ? selection?.field : undefined}
                editingField={owns(editing) ? (editing ?? undefined) : undefined}
                findings={edit.findings}
                followSelection={shared.followSelection}
                onSelect={shared.onSelect}
                edit={edit}
              />
              {group.subgroups?.map((sub) => (
                <GroupSection
                  {...shared}
                  key={sub.bg}
                  group={sub}
                  index={index}
                  keyPath={`${keyPath}/${sub.bg}`}
                  depth={depth + 1}
                  parentTitle={title}
                />
              ))}
            </>
          ))}
      </div>
    </section>
  );
});

export type HumanViewProps = {
  invoice: Invoice;
  fields: FieldIndex;
  format: FormatPlugin;
  selection: Selection;
  editing: FieldId | null;
  onSelect: (entry: FieldEntry) => void;
  edit: EditContext;
  country?: string;
};

export function HumanView({
  invoice,
  fields,
  format,
  selection,
  editing,
  onSelect,
  edit,
  country,
}: HumanViewProps) {
  const groups = useMemo(() => invoiceGroups(), []);
  const view = useStore((state) => state.workflow.groups);
  const locale = localeFor(country);
  const formatName = shortFormatName(format.label);
  const onToggle = useCallback(
    (key: string, open: boolean) => store.dispatch({ type: "setGroupOpen", key, open }),
    [],
  );

  const shared: SharedProps = {
    invoice,
    fields,
    locale,
    formatId: format.id,
    formatName,
    formatLabel: format.label,
    showUncarried: view.showUncarried,
    selection,
    editing,
    followSelection: selection !== null && selection.source !== "human",
    open: view.open,
    onToggle,
    onSelect,
    edit,
  };

  return (
    <div className="@container flex min-h-0 flex-col gap-3 overflow-auto bg-canvas p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 flex-1 text-[11px] text-muted">{EDIT_HINT}</p>
        <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
          <input
            type="checkbox"
            checked={view.showUncarried}
            onChange={(event) =>
              store.dispatch({ type: "showUncarried", show: event.target.checked })
            }
            className="accent-brand"
          />
          Show fields {formatName} cannot carry
        </label>
      </div>
      {groups.map((group) => (
        <GroupSection
          {...shared}
          key={group.bg}
          group={group}
          index={0}
          keyPath={group.bg}
          depth={0}
        />
      ))}
      <p className="border-t border-dashed border-line pt-2 text-[11px] text-muted">{DISCLAIMER}</p>
    </div>
  );
}
