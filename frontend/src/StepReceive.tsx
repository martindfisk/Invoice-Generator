export function StepReceive() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
      <section
        aria-label="Receive"
        className="rounded-l border border-line bg-surface p-4 text-sm shadow-s"
      >
        <h3 className="text-sm font-semibold">The inbox is not implemented yet</h3>
        <p className="mt-2 text-muted">
          This step will switch to the buyer side and list what arrived — live reception records
          from fiskaly plus the simulated entries the demo needs — so the same invoice can be opened
          in the viewer from the receiving end and diffed against what was sent.
        </p>
        <p className="mt-2 text-muted">
          The backend proxy endpoint is <span className="font-mono text-ink">GET /api/inbox</span>.
          Nothing is polled and no inbox entry is shown until that is wired up.
        </p>
      </section>
    </div>
  );
}
