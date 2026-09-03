import { describe, expect, it } from "vitest";
import { preset } from "../src/presets";
import { runValidation } from "../src/validation";

// A format whose writer refuses the invoice produces no XML — but the fiskaly contract stage
// checks the JSON operation and the model rules check the invoice, so neither may be silenced
// by the writer's limitation. Only the XML-inspecting tiers report unavailable, naming why.

describe("validation with a failed XML writer", () => {
  it("still runs the model and contract stages and names the writer failure on the XML tiers", async () => {
    const invoice = preset("it-b2b-sdi");
    const stages = await runValidation({
      invoice,
      formatId: "ubl",
      xml: "",
      xmlError: "CreditNote output is not implemented yet.",
    });

    const byId = new Map(stages.map((stage) => [stage.id, stage]));

    const model = byId.get("model");
    expect(model?.status === "passed" || model?.status === "failed").toBe(true);

    const contract = byId.get("uapi-schema");
    expect(contract).toBeDefined();
    expect(contract?.note ?? "").not.toMatch(/writer failed/);

    for (const id of ["well-formed", "xsd", "schematron"] as const) {
      const stage = byId.get(id);
      expect(stage?.status).toBe("unavailable");
      expect(stage?.note).toMatch(/writer failed: CreditNote output is not implemented yet\./);
    }
  });
});
