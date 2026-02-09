# sync-dev

Synchronize the `dev` branch with `main` and optionally create a feature branch.

## Usage

```
/sync-dev                      # Just sync dev with main
/sync-dev feat/my-feature      # Sync dev and create feature branch
```

## Workflow

1. Check for uncommitted changes (abort if dirty)
2. Checkout `dev` branch
3. Pull latest from `origin/main`
4. Push updated `dev` to `origin`
5. If feature name provided: create and checkout feature branch from `dev`
6. Report success with current branch

## Instructions

When this skill is invoked:

1. **Check for uncommitted changes:**
   ```bash
   git status --porcelain
   ```
   If output is non-empty, abort with message: "Working directory has uncommitted changes. Please commit or stash them first."

2. **Sync dev with main:**
   ```bash
   git checkout dev
   git pull origin main
   git push origin dev
   ```

3. **If feature branch name provided as argument:**
   - Ensure the branch name follows convention (e.g., `feat/`, `fix/`, `chore/`)
   - Create and checkout the branch:
     ```bash
     git checkout -b <branch-name>
     ```

4. **Report success:**
   - Show the current branch
   - If feature branch was created, confirm it was branched from `dev`

## Notes

- This follows the branching strategy in CLAUDE.md
- Feature branches should be created from `dev`, not `main`
- The `dev` branch is the active development branch
- `main` is the stable release branch
