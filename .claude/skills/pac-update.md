# pac-update

Update the PolicyAsCode (PaC) git dependency to the latest commit.

## Usage

```
/pac-update
```

## Workflow

1. Run `uv lock -P brd-to-opa-pipeline` to force-update the git dependency
2. Run `uv sync` to install the updated version
3. Extract and display the locked commit hash from `uv.lock`
4. Report the update status

## Instructions

When this skill is invoked:

1. **Update the lock file:**
   ```bash
   uv lock -P brd-to-opa-pipeline
   ```

2. **Sync dependencies:**
   ```bash
   uv sync
   ```

3. **Extract the locked commit:**
   ```bash
   grep -A2 'name = "brd-to-opa-pipeline"' uv.lock | grep 'rev = ' | sed 's/.*rev = "\([^"]*\)".*/\1/'
   ```

4. **Report results:**
   - Show the commit hash that was locked
   - If the commit changed, note that PolicyAsCode was updated
   - If the commit is the same, note that PaC was already at the latest version

## Notes

- This uses `uv lock -P` (or `--upgrade-package`) which is required for git dependencies
- Plain `uv lock` will NOT update git dependencies as it honors the existing lock file
- The package name in uv is `brd-to-opa-pipeline` (from PolicyAsCode's pyproject.toml)
