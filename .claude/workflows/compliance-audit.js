export const meta = {
  name: 'compliance-audit',
  description: 'Review every golden invoice fixture against FatturaPA 1.9.1 / Peppol BIS 3.0 / EN 16931 and adversarially verify each finding',
  whenToUse: 'Before a milestone tag or after changing mapping tables, presets or code lists',
  phases: [
    { title: 'Discover', detail: 'list golden and fixture XML files' },
    { title: 'Review', detail: 'one compliance-reviewer per file' },
    { title: 'Verify', detail: 'refute each finding independently' },
  ],
}

const FILES_SCHEMA = {
  type: 'object',
  properties: { files: { type: 'array', items: { type: 'string' } } },
  required: ['files'],
}
const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          rule: { type: 'string' },
          severity: { type: 'string', enum: ['blocking', 'should-fix', 'note'] },
          citation: { type: 'string' },
          summary: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['file', 'rule', 'severity', 'citation', 'summary'],
      },
    },
    confirmedCorrect: { type: 'array', items: { type: 'string' } },
  },
  required: ['findings'],
}
const VERDICT_SCHEMA = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['refuted', 'reason'],
}

phase('Discover')
const files =
  args?.files ??
  (
    await agent(
      'List every *.xml file under "frontend/tests/golden" and "backend/fixtures" in this repo as absolute paths. Return only the list.',
      { schema: FILES_SCHEMA, effort: 'low', label: 'discover' },
    )
  ).files
log(`${files.length} fixture(s) to review`)

const results = await pipeline(
  files,
  (f) =>
    agent(
      `Review the invoice fixture at ${f} for compliance with the applicable standard (detect FatturaPA vs Peppol BIS 3.0 UBL from the root element). Check mandatory elements, code lists, VAT arithmetic (BR-CO rules or SDI 004xx checks), identifiers and versions. Cite the exact rule/legal text with version for each finding and list what you confirmed correct.`,
      { agentType: 'compliance-reviewer', phase: 'Review', schema: FINDINGS_SCHEMA, label: `review:${f.split('/').pop()}` },
    ),
  (review, f) =>
    parallel(
      (review?.findings ?? []).map((finding) => () =>
        agent(
          `A reviewer claims about ${f}: "${finding.summary}" (rule ${finding.rule}, citation: ${finding.citation}). Read the file and the cited rule text. Try to refute the claim; set refuted=true if the finding is wrong, outdated or not applicable to this format/version. Be strict: default to refuted=true if the citation cannot be verified.`,
          { agentType: 'compliance-reviewer', phase: 'Verify', schema: VERDICT_SCHEMA, label: `verify:${finding.rule}` },
        ).then((v) => ({ ...finding, ...(v ?? { refuted: true, reason: 'verifier unavailable' }) })),
      ),
    ),
)

const all = results.flat().filter(Boolean)
const confirmed = all.filter((x) => !x.refuted)
log(`${confirmed.length} confirmed / ${all.length - confirmed.length} refuted`)
return { reviewed: files.length, confirmed, refuted: all.filter((x) => x.refuted) }
