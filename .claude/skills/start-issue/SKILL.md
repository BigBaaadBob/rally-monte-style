---
name: start-issue
description: Start work on a GitHub issue - check for a clean working tree, sync main, create a branch, read the issue and its brief, and propose a plan. Use only when the user types /start-issue.
argument-hint: <issue-number>
disable-model-invocation: true
---

# Start work on issue #$ARGUMENTS

## Issue and comments

!`gh issue view $ARGUMENTS --comments`

## Steps

1. If no issue number was given, stop and ask for one.
2. Run `git status --porcelain`. If it lists anything, stop. Show the changes and ask whether to commit, stash, or discard them. Never discard without explicit approval.
3. Run `git switch main`, then `git pull --ff-only`. If either fails, stop and report.
4. Choose the branch prefix from the issue's labels: `fix/` for `bug`, `docs/` for `docs`, otherwise `feat/`. Name the branch `<prefix>$ARGUMENTS-<3 to 5 word slug from the title>` and create it with `git switch -c`.
5. Find the brief: the most recent comment containing `Brief for #$ARGUMENTS`. If there is none, say so and ask whether to proceed from the issue text alone.
6. Read `docs/DESIGN.md` and the files the brief touches.
7. Present a plan with four parts:
   - the `docs/DESIGN.md` changes
   - the code changes, by file
   - the tests to add or update
   - anything in the brief that is ambiguous or conflicts with `docs/DESIGN.md`

Do not edit any file until the user approves the plan.
