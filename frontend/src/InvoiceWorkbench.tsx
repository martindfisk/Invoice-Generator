import { useCallback, useEffect, useMemo, useRef } from "react";
import { FORMATS, unsupportedReason, type FormatPlugin } from "./formats";
import { transmittable } from "./transmittable";
import { InvoiceViewer } from "./InvoiceViewer";
import type { FieldId, FormatId, Invoice } from "./model";
import { listPresets, type PresetId } from "./presets";
import { store, useStore } from "./store";
import { CORRECTION_PENDING_NOTE } from "./uapi-json";
import type { Finding } from "./validation";
import { composeOperation } from "./workflow";

const XML_DEBOUNCE_MS = 400;

const JSON_DEBOUNCE_MS = 400;

type Render = { xml?: string; error?: string };

function renderAll(invoice: Invoice): Map<FormatId, Render> {
  const renders = new Map<FormatId, Render>();
  for (const plugin of Object.values(FORMATS)) {
    const unsupported = unsupportedReason(plugin.id, invoice);
    if (unsupported) {
      renders.set(plugin.id, { error: unsupported });
      continue;
    }
    try {
      // The prediction is what fiskaly will generate, not what our writer can. Fields the
      // operation provably cannot deliver are blanked first, so the pane does not show elements
      // the transmitted document will not have — see transmittable.ts.
      renders.set(plugin.id, { xml: plugin.write(transmittable(invoice, plugin.id)) });
    } catch (error) {
      renders.set(plugin.id, { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return renders;
}

function writeFailure(
  formatId: FormatId,
  current: Render | undefined,
  available: FormatPlugin[],
): string {
  const why = current?.error ?? "This format is not registered.";
  const rest =
    available.length > 0
      ? ` This invoice still renders as ${available.map((plugin) => plugin.label).join(", ")}.`
      : "";
  return `${formatId} serialisation failed — ${why}${rest}`;
}

export type InvoiceWorkbenchProps = {
  invoice: Invoice;
  presetId: PresetId;
  findings?: Finding[];
  onXml?: (xml: string, error: string | null) => void;
};

export function InvoiceWorkbench({ invoice, presetId, findings, onXml }: InvoiceWorkbenchProps) {
  const workflow = useStore((state) => state.workflow);
  const { formatId, edit } = workflow;
  const renders = useMemo(() => renderAll(invoice), [invoice]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const report = useRef(onXml);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onEditXml = useCallback((text: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => store.dispatch({ type: "editXml", text }), XML_DEBOUNCE_MS);
  }, []);

  const onEditJson = useCallback((text: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => store.dispatch({ type: "editJson", text }), JSON_DEBOUNCE_MS);
  }, []);

  const onEditField = useCallback((field: FieldId, value: string) => {
    clearTimeout(timer.current);
    store.dispatch({ type: "editField", field, value });
  }, []);

  const operation = composeOperation(workflow);

  const meta = listPresets().find((candidate) => candidate.id === presetId);
  const available: FormatPlugin[] = [...renders.entries()]
    .filter(([, render]) => render.xml !== undefined)
    .map(([id]) => FORMATS[id]);
  const current = renders.get(formatId);
  const derived = current?.xml;
  const xmlText = edit.xml ?? derived ?? "";
  const xmlError =
    edit.error ??
    (edit.xml === null && derived === undefined
      ? writeFailure(formatId, current, available)
      : null);

  useEffect(() => {
    report.current = onXml;
  });

  useEffect(() => {
    report.current?.(xmlText, xmlError);
  }, [xmlText, xmlError]);

  return (
    <>
      <header className="flex shrink-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="text-sm font-semibold text-ink">{meta?.label ?? presetId}</h2>
        {meta && <span className="font-mono text-[11px] text-muted">{meta.formatLabel}</span>}
        {meta && <span className="text-[11px] text-muted">· {meta.legalBasis}</span>}
      </header>
      <InvoiceViewer
        invoice={invoice}
        format={FORMATS[formatId]}
        formats={available}
        xmlText={xmlText}
        xmlError={xmlError}
        jsonText={operation.text}
        jsonError={operation.error}
        jsonLabel={operation.label}
        jsonNote={operation.correctionPending ? CORRECTION_PENDING_NOTE : null}
        jsonPrefix={operation.prefix}
        edit={edit}
        presetLabel={meta?.label ?? presetId}
        country={meta?.country}
        findings={findings}
        onFormat={(next) => store.dispatch({ type: "setFormat", formatId: next })}
        onEditField={onEditField}
        onEditXml={onEditXml}
        onEditJson={onEditJson}
        onDismissNotice={() => store.dispatch({ type: "dismissEditNotice" })}
      />
    </>
  );
}
