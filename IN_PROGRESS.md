# IN_PROGRESS.md — GitBar

**Last updated:** 2026-05-22
**Phase:** Phase 4. v0.1.0 release prep

## Active task
- **Task:** `gitbar-p4-release-prep`. Bundle identifier rename, README accuracy, RELEASING.md, release-workflow degrade, pre-commit fix, Gatekeeper warning
- **Artifacts:** none (delivery captured directly in the PR description and `RELEASING.md`)
- **Status:** `in-progress`

## Blocked on
- `none`

## Next step
- Land PR C (this branch), PRs #26 (stability) and #27 (Retina), then tag `v0.1.0` and follow `RELEASING.md`.
- Post-v0.1.0: Apple Developer ID + notarization, monochrome tray template icon, PAT zeroization (`secrecy` crate), structured logging via `tracing`.

## Phase history

| Phase | Task | Status | Completed |
|---|---|---|---|
| 4 | gitbar-p4-release-prep (PR C from audit) | in-progress | (in flight) |
| 3 | gitbar-p3-oss-docs + keychain PAT + auto-update + signed release pipeline + app icon + audit | delivered | PRs #5, #15, #16, #17, #18, #19, #20, #21, #22, #23, #24, #25 (2026-05-18 to 2026-05-22) |
| 2 | gitbar-p2-audit-refactor + UI polish + filters + deploy-link convention | delivered | PR #3, #4 (2026-05-18) |
| 1 | gitbar-p1-polish (drag + minimize + strip) | delivered | 2026-05-18 |
| 0 | gitbar-v1 (MVP scaffold) | delivered | 2026-05-17 |
