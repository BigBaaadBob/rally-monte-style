---
name: ship
description: Finish the current issue branch - confirm docs/DESIGN.md changed, run the tests, commit design and code separately, push, and open a pull request that closes the issue. Use only when the user types /ship.
disable-model-invocation: true
---

# Ship the current branch

## Current state

!`git branch --show-current`
!`git status --short`
!`git diff --stat main...HEAD`

## Steps

1. Take the issue number from the branch name: the digits after the prefix (`fix/14-pause-at-restart` gives 14). If the branch is `main` or has no number, stop and report.
2. Check that `docs/DESIGN.md` changed on this branch, committed or not. If it did not, ask whether this change truly needs no design update. Continue only on a clear yes.
3. Run `test/run-all.sh`.
   - If any test fails, stop and report the failures. Do not commit.
   - Exception: if the only failures are end-to-end tests that cannot run on this machine for a reason recorded in `CLAUDE.md`, report that and continue. CI on GitHub runs them.
4. Commit in two steps. Before each commit, list the files it will include.
   - If `docs/DESIGN.md` has uncommitted changes, commit it alone first: `Design: <one-line summary> (#N)`.
   - Commit everything else: subject `<one-line summary>`, body `Closes #N`.
   - Before each commit, scan the staged diff (`git diff --cached`) for secrets (`.env` files, keys, tokens) and personal information: real names, email addresses, phone numbers, street addresses, account or user IDs, private URLs (claude.ai artifact or chat links, shared-drive links), and photos or screenshots of real documents or people. The public Pages URL is allowed. The sample crew "Jane Driver" and "John Navigator" is allowed.
   - If anything turns up, stop. List each item with its file and line, and wait for explicit approval of that specific item. A request to ship is not approval for personal information.
5. Ask for approval to push. Show the branch name, the commits to be pushed (`git log --oneline main..HEAD`), and the diff stat. Wait for a clear yes. Do not push without it.
6. Push: `git push -u origin HEAD`.
7. Open the pull request: `gh pr create --base main --title "<one-line summary>"`. The body states what changed, how it was tested (including any tests skipped in step 3 and why), and ends with `Closes #N`.
8. Report the pull request URL and the output of `gh pr checks`. Checks may still be pending.

Do not merge. Merging is the user's decision, made on GitHub after review.
