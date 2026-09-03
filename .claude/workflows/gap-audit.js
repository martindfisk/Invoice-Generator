export const meta = {
  name: 'gap-audit',
  description: 'Verify the claims in docs/gaps/gap-report.json against the standards, then adversarially refute each verdict',
  whenToUse: 'After make gap-report changes, and before handing the gap tickets to the team',
  phases: [
    { title: 'Discover', detail: 'group the report into (format, missingFrom) slices by declared cause' },
    { title: 'Review', detail: 'one gap-reviewer per slice, offline sources first' },
    { title: 'Verify', detail: 'refute each claim independently' },
  ],
}

const SLICES_SCHEMA = {
  type: 'object',
  properties: {
    slices: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          format: { type: 'string' },
          missingFrom: { type: 'string', enum: ['model', 'json', 'xml'] },
          causes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                reason: { type: 'string' },
                rowCount: { type: 'integer' },
                severity: { type: 'string', enum: ['blocking', 'should-fix', 'note'] },
                sampleRowIds: { type: 'array', items: { type: 'string' } },
              },
              required: ['reason', 'rowCount', 'severity'],
            },
          },
        },
        required: ['format', 'missingFrom', 'causes'],
      },
    },
  },
  required: ['slices'],
}

const SOURCE_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['vendor', 'local', 'repo', 'web'] },
    ref: { type: 'string' },
    retrievedAt: { type: 'string' },
  },
  required: ['kind', 'ref'],
}

const CAUSE_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
          rowIds: { type: 'array', items: { type: 'string' } },
          proposition: {
            type: 'string',
            enum: ['gap-is-real', 'belongs-at-correct', 'severity-correct', 'reason-true', 'applicability-correct'],
          },
          verdict: { type: 'string', enum: ['confirmed', 'refuted', 'unproven'] },
          severity: { type: 'string', enum: ['blocking', 'should-fix', 'note'] },
          citation: { type: 'string' },
          source: SOURCE_SCHEMA,
          summary: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['reason', 'rowIds', 'proposition', 'verdict', 'citation', 'source', 'summary'],
      },
    },
    notCheckable: { type: 'array', items: { type: 'string' } },
  },
  required: ['claims'],
}

const CAUSE_VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
    citationVerified: { type: 'boolean' },
    sourceReachable: { type: 'boolean' },
    correctedVerdict: { type: 'string', enum: ['confirmed', 'refuted', 'unproven'] },
  },
  required: ['refuted', 'reason', 'citationVerified', 'sourceReachable'],
}

const REPORT = 'docs/gaps/gap-report.json'
const TIERS = args?.all ? ['blocking', 'should-fix', 'note'] : ['blocking', 'should-fix']

phase('Discover')
const { slices } = await agent(
  `Read ${REPORT}. Group its rows by (format, missingFrom). Within each group, collapse rows that share the same "reason" into one cause, recording the reason verbatim, how many rows carry it, the highest severity among them (blocking > should-fix > note) and up to five example row ids. Return only groups that contain at least one cause whose severity is in ${JSON.stringify(TIERS)}, and inside those groups drop causes outside that list. Return only the structure.`,
  { schema: SLICES_SCHEMA, effort: 'low', label: 'discover' },
)
const causes = slices.reduce((total, slice) => total + slice.causes.length, 0)
log(`${slices.length} slice(s), ${causes} cause(s) at ${TIERS.join('/')}`)

phase('Review')
const results = await pipeline(
  slices,
  (slice) =>
    agent(
      `Verify the gap-report claims for format "${slice.format}", missingFrom "${slice.missingFrom}". Read ${REPORT} and take only the rows matching that pair whose reason is one of:\n\n${slice.causes.map((c) => `- (${c.severity}, ${c.rowCount} rows) ${c.reason}`).join('\n')}\n\nFor each cause, judge the propositions that apply: gap-is-real, belongs-at-correct, reason-true, severity-correct, applicability-correct. Consult the offline sources named in your instructions before any web fetch, and cite the exact document and version. Be explicit where FatturaPA is concerned about whether you are applying EN 16931 semantics by analogy or citing FatturaPA's own specification — it is not a CIUS of EN 16931. Set verdict to unproven when no available source settles the point.`,
      {
        agentType: 'gap-reviewer',
        phase: 'Review',
        schema: CAUSE_REVIEW_SCHEMA,
        label: `review:${slice.format}/${slice.missingFrom}`,
      },
    ),
  (review, slice) =>
    parallel(
      (review?.claims ?? [])
        .filter((claim) => claim.verdict === 'confirmed' && TIERS.includes(claim.severity ?? 'note'))
        .map((claim) => () =>
          agent(
            `A reviewer claims about ${slice.format}/${slice.missingFrom}: "${claim.summary}" (proposition ${claim.proposition}, citation: ${claim.citation}, source ${claim.source.kind}:${claim.source.ref}). Read that source and the rows ${claim.rowIds.slice(0, 5).join(', ')} in ${REPORT}. Try to refute the claim. Set refuted=true if it is wrong, outdated, or not applicable to this format or version. Be strict: default to refuted=true if the citation cannot be verified. A source of kind vendor, local or repo whose ref does not exist on disk is sourceReachable=false and refutes the claim.`,
            {
              agentType: 'gap-reviewer',
              phase: 'Verify',
              schema: CAUSE_VERDICT_SCHEMA,
              label: `verify:${claim.proposition}`,
            },
          ).then((v) => ({
            ...claim,
            format: slice.format,
            missingFrom: slice.missingFrom,
            ...(v ?? { refuted: true, reason: 'verifier unavailable', citationVerified: false, sourceReachable: false }),
          })),
        ),
    ),
)

const all = results.flat().filter(Boolean)
const confirmed = all.filter((claim) => !claim.refuted)
const refuted = all.filter((claim) => claim.refuted)
log(`${confirmed.length} confirmed / ${refuted.length} refuted of ${all.length} verified claim(s)`)

// Returned, not written: docs/gaps/verdicts.json is a human-reviewed artefact, and the repo
// forbids unrequested commits. Save this payload there to let make gap-check enforce it.
return {
  report: REPORT,
  tiers: TIERS,
  slices: slices.length,
  causes,
  claims: all.map((claim) => ({
    reason: claim.reason,
    rowIds: claim.rowIds,
    format: claim.format,
    missingFrom: claim.missingFrom,
    proposition: claim.proposition,
    status: claim.refuted ? 'refuted' : (claim.correctedVerdict ?? claim.verdict),
    severity: claim.severity ?? null,
    citation: claim.citation,
    source: claim.source,
    summary: claim.summary,
    verifier: { refuted: claim.refuted, reason: claim.reason, citationVerified: claim.citationVerified, sourceReachable: claim.sourceReachable },
  })),
}
