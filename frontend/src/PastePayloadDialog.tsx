import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import { getFormat } from "./formats";
import { Modal } from "./Modal";
import type { FormatId } from "./model";
import {
  defaultFormat,
  exampleText,
  formatsFor,
  lookupPasted,
  PASTE_COUNTRIES,
  recipientMismatch,
  type PastedCountry,
} from "./pasted";
import { store, useStore } from "./store";
import { unwrapPayload } from "./uapi-json";
import { validateUapiOperation, type UapiSchemaOutcome } from "./uapi-schema-client";
import { loadPasted } from "./workflow";

const PRECHECK_DEBOUNCE_MS = 400;

type Parsed =
  { ok: true; label: string; mismatch: string | null } | { ok: false; error: string } | null;

function parse(text: string, country: PastedCountry): Parsed {
  if (text.trim() === "") return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      error: `Not valid JSON: ${error instanceof Error ? error.message : error}`,
    };
  }
  try {
    const unwrapped = unwrapPayload(value);
    return {
      ok: true,
      label: unwrapped.label,
      mismatch: recipientMismatch(unwrapped.operation, country),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function contractLine(outcome: UapiSchemaOutcome | "checking" | null): {
  text: string;
  tone: string;
} | null {
  if (outcome === null) return null;
  if (outcome === "checking")
    return { text: "Checking against the fiskaly spec…", tone: "text-muted" };
  if (outcome.status === "unavailable") {
    return { text: `Contract pre-check not run: ${outcome.reason}`, tone: "text-muted" };
  }
  if (outcome.valid) {
    return {
      text: `Matches the fiskaly API contract (${outcome.country} spec). Step 3 re-checks it.`,
      tone: "text-success",
    };
  }
  const first = outcome.errors[0];
  return {
    text: `${outcome.errors.length} contract error${outcome.errors.length === 1 ? "" : "s"} — e.g. ${first.pointer || "/"}: ${first.message}. You can still open it; Step 3 lists them all.`,
    tone: "text-warning-ink",
  };
}

export function PastePayloadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const config = useStore((state) => state.config);
  const mode = useStore((state) => state.mode);
  const [country, setCountry] = useState<PastedCountry>("IT");
  const [formatId, setFormatId] = useState<FormatId>(defaultFormat("IT"));
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  // The pre-check result is keyed by the text and country it answers; while the key differs
  // from the current one the dialog is "checking", with no state written inside the effect.
  const [checked, setChecked] = useState<{ key: string; outcome: UapiSchemaOutcome } | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const textareaId = useId();
  const fileInput = useRef<HTMLInputElement | null>(null);

  const parsed = useMemo(() => parse(text, country), [text, country]);
  const formats = formatsFor(country);
  const format = formats.includes(formatId) ? formatId : formats[0];

  // The pre-check is advisory: it tells the user what Step 3 will say before they leave Setup,
  // and never blocks — a payload that fails the contract is a legitimate thing to study.
  const checkKey = `${country}\n${text}`;
  useEffect(() => {
    if (!open || !parsed?.ok) return;
    const aborter = new AbortController();
    const timer = setTimeout(() => {
      let value: unknown;
      try {
        value = unwrapPayload(JSON.parse(text)).operation;
      } catch {
        return;
      }
      void validateUapiOperation(value, country, aborter.signal).then((result) => {
        if (!aborter.signal.aborted) setChecked({ key: checkKey, outcome: result });
      });
    }, PRECHECK_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      aborter.abort();
    };
  }, [open, parsed?.ok, text, country, checkKey]);
  const outcome: UapiSchemaOutcome | "checking" | null = !parsed?.ok
    ? null
    : checked?.key === checkKey
      ? checked.outcome
      : "checking";

  const readFile = (file: File | undefined) => {
    if (!file) return;
    setFileError(null);
    file
      .text()
      .then((content) => setText(content))
      .catch((error) => setFileError(`Could not read ${file.name}: ${error}`));
  };

  const onDrop = (event: DragEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    setDragging(false);
    readFile(event.dataTransfer.files[0]);
  };

  const openInMapper = () => {
    if (!parsed?.ok) return;
    try {
      loadPasted(text, country, format);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error));
      return;
    }
    store.dispatch({ type: "loadPayload", text, country, formatId: format });
    onClose();
    // The account lookup trails the load: the Mapper opens on the placeholder at once and the
    // seller plus the VAT code lists replace it when (and if) the backend answers.
    const live = mode === "LIVE";
    void lookupPasted(country, config, live).then((lookup) => {
      const current = store.getState().workflow.pasted;
      if (current?.text !== text) return;
      store.dispatch({
        type: "pastedLookup",
        seller: lookup.seller,
        source: lookup.source,
        ctx: lookup.ctx,
        note: lookup.note,
      });
    });
  };

  const contract = contractLine(outcome);
  const control =
    "rounded-m border border-line bg-canvas px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none";

  return (
    <Modal
      open={open}
      labelledBy={titleId}
      describedBy={descriptionId}
      onClose={onClose}
      className="flex max-h-[90vh] max-w-4xl flex-col gap-3 overflow-hidden p-4"
    >
      <h2 id={titleId} className="text-sm font-semibold text-ink">
        Paste your own payload
      </h2>
      <p id={descriptionId} className="text-xs text-muted">
        A fiskaly <span className="font-mono">TRANSACTION::INVOICE</span> operation (or the whole{" "}
        <span className="font-mono">POST /records</span> body, or a{" "}
        <span className="font-mono">TRANSACTION::CORRECTION</span>). The Mapper shows it verbatim
        next to the BT fields and the predicted XML; Validate runs the contract and document checks
        on it. Nothing is sent to fiskaly.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11px] font-medium text-muted">
          Country
          <select
            value={country}
            onChange={(event) => {
              const next = event.target.value as PastedCountry;
              setCountry(next);
              setFormatId(defaultFormat(next));
            }}
            className={control}
          >
            {PASTE_COUNTRIES.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.name} ({entry.code})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-muted">
          Predicted format
          <select
            value={format}
            onChange={(event) => setFormatId(event.target.value as FormatId)}
            className={control}
          >
            {formats.map((id) => (
              <option key={id} value={id}>
                {getFormat(id).label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setText(exampleText(country))}
          className="rounded-m border border-line px-2 py-1 text-xs font-medium text-muted hover:border-brand hover:text-ink"
        >
          Load example
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="rounded-m border border-line px-2 py-1 text-xs font-medium text-muted hover:border-brand hover:text-ink"
        >
          Upload .json
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="Upload a JSON payload"
          onChange={(event) => {
            readFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>

      <label htmlFor={textareaId} className="sr-only">
        Payload JSON
      </label>
      <textarea
        id={textareaId}
        value={text}
        spellCheck={false}
        placeholder={
          '{\n  "type": "INVOICE",\n  "document": { ... },\n  "entries": [ ... ],\n  "recipients": [ ... ],\n  "payments": [ ... ],\n  "breakdown": [ ... ],\n  "totals": { ... }\n}\n\nPaste here, or drop a .json file.'
        }
        onChange={(event) => setText(event.target.value)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`min-h-[14rem] flex-1 resize-y rounded-m border bg-canvas p-2 font-mono text-[11px] leading-snug text-ink focus:outline-none ${
          dragging ? "border-brand" : parsed && !parsed.ok ? "border-error" : "border-line"
        }`}
      />

      <div className="flex min-h-[1.5rem] flex-col gap-1 text-[11px]" aria-live="polite">
        {fileError && <p className="text-error-ink">{fileError}</p>}
        {parsed && !parsed.ok && (
          <p role="alert" className="text-error-ink">
            {parsed.error}
          </p>
        )}
        {parsed?.ok && (
          <p className="text-muted">
            Recognised as <span className="font-mono text-ink">{parsed.label}</span>.
          </p>
        )}
        {parsed?.ok && parsed.mismatch && (
          <p data-mismatch className="text-warning-ink">
            <span aria-hidden="true">▲ </span>
            {parsed.mismatch}
          </p>
        )}
        {contract && (
          <p
            data-precheck={outcome === "checking" ? "checking" : outcome?.status}
            className={contract.tone}
          >
            {contract.text}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!parsed?.ok}
          onClick={openInMapper}
          className="rounded-m bg-brand px-3 py-1.5 text-xs font-semibold text-bunker disabled:cursor-not-allowed disabled:opacity-60"
        >
          Open in Mapper
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-m border border-line px-3 py-1.5 text-xs font-medium text-muted hover:border-brand hover:text-ink"
        >
          Cancel
        </button>
        <p className="text-[11px] text-muted">
          Send stays disabled for a pasted payload — this journey ends at Validate.
        </p>
      </div>
    </Modal>
  );
}
