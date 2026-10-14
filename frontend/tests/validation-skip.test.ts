import { describe, expect, it, vi } from "vitest";
import { getFormat } from "../src/formats";
import { preset } from "../src/presets";
import { runValidation, SKIPPED_NOTE, stagesFor, type FindingSource } from "../src/validation";

vi.mock("../src/schematron.worker", () => ({ runSchematron: vi.fn() }));

function ublInput() {
  const invoice = preset("be-peppol");
  return { invoice, formatId: "ubl" as const, xml: getFormat("ubl").write(invoice) };
}

describe("runValidation with unticked stages", () => {
  it("reports an unticked stage as skipped and still runs the others", async () => {
    const skip = new Set<FindingSource>(["uapi-schema", "xsd", "schematron", "sdi-rules"]);
    const seen: string[] = [];
    const results = await runValidation({ ...ublInput(), skip }, (stage) =>
      seen.push(`${stage.id}:${stage.status}`),
    );
    expect(results.map((stage) => stage.id)).toEqual(stagesFor("ubl").map((stage) => stage.id));
    for (const stage of results) {
      if (skip.has(stage.id)) {
        expect(stage.status).toBe("skipped");
        expect(stage.note).toBe(SKIPPED_NOTE);
        expect(stage.findings).toEqual([]);
      } else {
        expect(["passed", "failed"]).toContain(stage.status);
      }
    }
    // A skipped stage is announced once, never as running.
    expect(seen.filter((entry) => entry.startsWith("uapi-schema:"))).toEqual([
      "uapi-schema:skipped",
    ]);
    expect(seen).toContain("model:running");
  });

  it("skipping well-formedness does not short-circuit the stages after it", async () => {
    const skip = new Set<FindingSource>(["uapi-schema", "well-formed", "xsd", "schematron"]);
    const results = await runValidation({ ...ublInput(), skip });
    const model = results.find((stage) => stage.id === "model");
    expect(model?.status).toBe("passed");
    expect(results.find((stage) => stage.id === "well-formed")?.status).toBe("skipped");
  });
});
