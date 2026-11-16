---
name: finish
description: Clean up after a merged pull request - return to main, pull, delete the merged branch, and confirm the issue closed. Use only when the user types /finish.
disable-model-invocation: true
---

# Finish after the merge

## Current branch

!`git branch --show-current`

## Steps

1. Note the current branch (call it B) and the issue number N from its name. If B is `main`, ask which branch to clean up.
2. Check the pull request: `gh pr view B --json state,mergedAt,url`. If its state is not `MERGED`, stop and report. Never delete unmerged work.
3. Run `git switch main`, then `git pull --ff-only`.
4. Delete the local branch: `git branch -d B`. If git refuses because the branch is "not fully merged" (normal after a squash merge), and step 2 showed `MERGED`, ask the user before running `git branch -D B`.
5. Check for the remote branch: `git ls-remote --heads origin B`. If it still exists, ask before running `git push origin --delete B`.
6. Confirm the issue closed: `gh issue view N --json state`. If it is still open, report it. The pull request probably lacked `Closes #N`.
7. If the merge changed `README.md`, `CLAUDE.md`, or `docs/DESIGN.md`, remind the user to click **Sync** in the Road Rally Project.
