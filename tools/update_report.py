#!/usr/bin/env python3
"""Assemble the markdown diff report for an upstream-update PR body.

Reads whatever capture files exist in --dir (all optional; a missing file renders
as "not captured"):
  update.txt                 stdout of fetch_assets.py --update / fetch_spec.py
  diffstat.txt               git diff --stat of the committed files on the branch
  vendor-before/, vendor-after/   snapshots of the vendored rule files (vendor/ is
                             git-ignored, so rule changes are invisible in the PR
                             diff; the report computes an added/removed rule-id set)
  schematron-expected.diff   verbatim `npm run schematron:expected` output
  verify.md                  verification results table built by the workflow

Prints markdown to stdout, truncating the largest sections past --max-bytes
(GitHub caps PR bodies at ~65k) with a pointer to the workflow run artifact.
"""

import argparse
import os
import re
import sys
from pathlib import Path

RULE_ID = re.compile(r'\bid="([^"]+)"')


def read_optional(path):
    return path.read_text(errors="replace").strip() if path.exists() else None


def fenced(text, lang=""):
    return f"```{lang}\n{text}\n```"


def rule_id_diff(before_dir, after_dir):
    """Added/removed rule ids per rule file, from the vendor snapshots."""
    if not before_dir.is_dir() or not after_dir.is_dir():
        return None
    suffixes = {".sch", ".xslt", ".xsl"}
    names = sorted(
        {
            p.relative_to(d)
            for d in (before_dir, after_dir)
            for p in d.rglob("*")
            if p.suffix in suffixes
        }
    )
    lines = []
    for name in names:
        old_file, new_file = before_dir / name, after_dir / name
        if not old_file.exists():
            lines.append(f"- `{name}`: new file")
            continue
        if not new_file.exists():
            lines.append(f"- `{name}`: removed")
            continue
        old_ids = set(RULE_ID.findall(old_file.read_text(errors="replace")))
        new_ids = set(RULE_ID.findall(new_file.read_text(errors="replace")))
        added, removed = sorted(new_ids - old_ids), sorted(old_ids - new_ids)
        if not added and not removed:
            byte_change = old_file.read_bytes() != new_file.read_bytes()
            lines.append(
                f"- `{name}`: no rule ids added or removed"
                + (
                    " (content changed — see the run artifact for the full diff)"
                    if byte_change
                    else " (byte-identical)"
                )
            )
            continue
        lines.append(f"- `{name}`: +{len(added)} / -{len(removed)} rule ids")
        for rid in added:
            lines.append(f"  - added `{rid}`")
        for rid in removed:
            lines.append(f"  - removed `{rid}`")
    return "\n".join(lines) if lines else None


def next_steps(args):
    steps = []
    if args.kind == "ruleset":
        steps.append(
            "Run `npm run schematron:expected` locally, then update the EXPECTED table and the "
            "reviewed-version pin in `frontend/tests/schematron-goldens.test.ts` with a "
            "justification — the goldens test on this branch fails until you do, by design."
        )
        if args.source == "xrechnung":
            steps.append(
                "`--update` does not touch `vars.cius` or the bundle dates in `localSubdirs` of "
                "`tools/rulesets.json` — edit them manually if the CIUS version moved."
            )
        if args.source == "peppol":
            steps.append(
                "Update the release-name parenthetical in the peppol source `title` in "
                "`tools/rulesets.json` manually."
            )
    if args.kind == "spec":
        steps.append(
            "Review the spec diff and the regenerated `spec/spec.json` / `spec/version.txt`."
        )
        if args.drop_behind:
            steps.append(
                "**The active all-products spec is now behind the per-country CalVers.** It cannot "
                "be fetched — obtain the new `fiskaly.unified-api.all.<version>.yaml`, place it in "
                "`spec/drop/`, and run `make spec` on this branch."
            )
    steps.append(
        "CI does not auto-trigger on bot-created PRs: push any commit to this branch (or close "
        "and reopen the PR) to run it before merging."
    )
    steps.append(
        "Merge to accept the update; close the PR to reject it (keep the branch so the watch does not re-propose it)."
    )
    return "\n".join(f"- {s}" for s in steps)


def run_link():
    server = os.environ.get("GITHUB_SERVER_URL")
    repo = os.environ.get("GITHUB_REPOSITORY")
    run_id = os.environ.get("GITHUB_RUN_ID")
    if server and repo and run_id:
        return f"{server}/{repo}/actions/runs/{run_id}"
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--source", required=True)
    ap.add_argument("--kind", required=True, choices=("ruleset", "spec"))
    ap.add_argument("--old", required=True)
    ap.add_argument("--new", required=True)
    ap.add_argument("--dir", required=True, type=Path)
    ap.add_argument("--release-url", default="")
    ap.add_argument("--rule-sets", default="", help="comma-separated affected rule-set ids")
    ap.add_argument("--drop-behind", action="store_true")
    ap.add_argument("--max-bytes", type=int, default=60000)
    args = ap.parse_args()

    header = [
        f"Upstream update detected by the monthly watch: `{args.source}` **{args.old} → {args.new}**."
    ]
    if args.release_url:
        header.append(f"Release notes: {args.release_url}")
    if args.rule_sets:
        ids = ", ".join(f"`{r}`" for r in args.rule_sets.split(",") if r)
        header.append(f"Affected rule sets: {ids}.")
    link = run_link()
    if link:
        header.append(f"Full captures (raw vendor diff included): [workflow run]({link}).")

    update_txt = read_optional(args.dir / "update.txt")
    diffstat = read_optional(args.dir / "diffstat.txt")
    expected = read_optional(args.dir / "schematron-expected.diff")
    verify = read_optional(args.dir / "verify.md")
    rules = rule_id_diff(args.dir / "vendor-before", args.dir / "vendor-after")

    # (title, body, truncation priority — higher shrinks first; 0 never shrinks)
    sections = [("", "\n\n".join(header), 0)]
    sections.append(
        ("## What changed upstream", fenced(update_txt) if update_txt else "_not captured_", 2)
    )
    if args.kind == "ruleset":
        sections.append(("## Rule-level changes", rules or "_not captured_", 3))
    sections.append(("## Repository diff", fenced(diffstat) if diffstat else "_not captured_", 1))
    if args.kind == "ruleset":
        sections.append(
            (
                "## Validation impact (`schematron:expected`)",
                fenced(expected, "diff") if expected else "_in sync — no golden-finding changes_",
                2,
            )
        )
    sections.append(("## Verification", verify or "_not captured_", 0))
    sections.append(("## Next steps for the reviewer", next_steps(args), 0))

    def total(parts):
        return sum(len(t) + len(b) + 4 for t, b, _ in parts)

    note = "\n… truncated — full output in the workflow run artifact" + (
        f": {link}" if link else "."
    )
    for priority in (3, 2, 1):
        if total(sections) <= args.max_bytes:
            break
        for i, (title, body, prio) in enumerate(sections):
            if prio != priority or total(sections) <= args.max_bytes:
                continue
            excess = total(sections) - args.max_bytes
            keep = max(500, len(body) - excess - len(note))
            if keep < len(body):
                trimmed = body[:keep]
                if body.startswith("```"):
                    trimmed += "\n```"
                sections[i] = (title, trimmed + note, 0)

    out = "\n\n".join(f"{t}\n\n{b}" if t else b for t, b, _ in sections)
    sys.stdout.write(out + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
