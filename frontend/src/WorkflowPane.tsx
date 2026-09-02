import type { ComponentType } from "react";
import { StepMapper } from "./StepMapper";
import { StepReceive } from "./StepReceive";
import { StepSend } from "./StepSend";
import { StepSetup } from "./StepSetup";
import { StepValidate } from "./StepValidate";
import { store, useStore } from "./store";
import { STEPS, stepLock, type Step } from "./workflow";

const CONTENT: Record<Step, ComponentType> = {
  setup: StepSetup,
  mapper: StepMapper,
  validate: StepValidate,
  send: StepSend,
  receive: StepReceive,
};

export function WorkflowPane() {
  const workflow = useStore((state) => state.workflow);
  const active = STEPS.findIndex((step) => step.id === workflow.step);
  const Content = CONTENT[workflow.step];

  return (
    <section aria-label="Workflow" className="flex h-full min-h-0 flex-col bg-canvas">
      <ol className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-4 py-2 text-xs">
        {STEPS.map((step, index) => {
          const current = index === active;
          const lock = stepLock(workflow, step.id);
          const done = !lock && index < active;
          return (
            <li key={step.id} className="flex items-center gap-2">
              <button
                type="button"
                disabled={Boolean(lock)}
                title={lock ?? step.blurb}
                aria-current={current ? "step" : undefined}
                onClick={() => store.dispatch({ type: "goToStep", step: step.id })}
                className={`flex items-center gap-1.5 rounded-m px-2 py-1 font-medium ${
                  current
                    ? "bg-brand-soft text-brand-ink"
                    : done
                      ? "text-ink hover:bg-surface-raised"
                      : "text-muted hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                }`}
              >
                <span className="font-mono">{index + 1}</span>
                {step.label}
              </button>
              {index < STEPS.length - 1 && <span aria-hidden="true" className="h-px w-4 bg-line" />}
            </li>
          );
        })}
      </ol>
      <Content />
    </section>
  );
}
