export const meta = {
  name: 'review-change',
  description: 'Parallel correctness, compliance and security review of the current git diff, each finding adversarially verified',
  whenToUse: 'Before asking the user to commit, or after a multi-file change',
  phases: [
    { title: 'Review', detail: 'three independent lenses over the diff' },
    { title: 'Verify', detail: 'one skeptic per finding' },
  ],
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
          title: { type: 'string' },
          detail: { type: 'string' },
          severity: { type: 'string', enum: ['blocking', 'should-fix', 'note'] },
        },
        required: ['file', 'title', 'detail', 'severity'],
      },
    },
  },
  required: ['findings'],
}
const VERDICT_SCHEMA = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['refuted', 'reason'],
}

const scope = args?.ref ? `git diff ${args.ref}` : 'git diff HEAD (staged and unstaged) plus untracked files'
const LENSES = [
  {
    key: 'correctness',
    prompt: `Run "${scope}" in this repo and review the changed code for correctness bugs, contract drift between frontend (src/api-log.ts, uapi-client.ts) and backend (routes.py, recorder.py), decimal/rounding mistakes, and violations of .claude/rules/*.md. Report only real defects with file:line.`,
  },
  {
    key: 'compliance',
    prompt: `Run "${scope}" in this repo and review changed mapping tables, writers, presets, code lists, rules and UI labels against FatturaPA 1.9.1, Peppol BIS Billing 3.0 and EN 16931. Cite rule ids or legal text with version. Report only substantiated findings with file:line.`,
    agentType: 'compliance-reviewer',
  },
  {
    key: 'security',
    prompt: `Run "${scope}" in this repo and review for secret leakage (logs, fixtures, SSE, cURL output), missing masking, SSRF/path issues in the /api/uapi passthrough, unsafe XML handling, CORS mistakes and dependency risks. Report only real issues with file:line.`,
  },
]

const results = await pipeline(
  LENSES,
  (lens) =>
    agent(lens.prompt, {
      phase: 'Review',
      schema: FINDINGS_SCHEMA,
      label: `review:${lens.key}`,
      ...(lens.agentType ? { agentType: lens.agentType } : {}),
    }),
  (review, lens) =>
    parallel(
      (review?.findings ?? []).map((f) => () =>
        agent(
          `Verify this ${lens.key} review finding in ${f.file}${f.line ? ':' + f.line : ''}: "${f.title}" — ${f.detail}. Read the code. Try to refute it; set refuted=true unless you can confirm the defect concretely.`,
          { phase: 'Verify', schema: VERDICT_SCHEMA, label: `verify:${lens.key}` },
        ).then((v) => ({ lens: lens.key, ...f, ...(v ?? { refuted: true, reason: 'verifier unavailable' }) })),
      ),
    ),
)

const all = results.flat().filter(Boolean)
const confirmed = all.filter((x) => !x.refuted)
log(`${confirmed.length} confirmed finding(s), ${all.length - confirmed.length} refuted`)
return { confirmed, refuted: all.filter((x) => x.refuted) }
