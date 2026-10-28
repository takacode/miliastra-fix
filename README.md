# Miliastra Fix

A browser workbench for editing Miliastra `.gil` stages and `.gia` assets. Trace graph variables through composites, review repairs, edit initial values and download a validated copy. Files stay on your device.

**v0.3 release candidate.** File preservation, repair semantics and the browser workflow are verified. **Editor 7.1.0 passes the Entity scalar repair, rename and initial-value runtime probe.** Direct GIA import also preserves all ten tested declarations. Composite runtime, other owner categories and native export/reimport remain pending. See the exact [verification evidence](docs/VERIFICATION.md).

## Use it

Use Node.js 22 or later; no package installation is needed.

```sh
npm run dev
```

Open **http://127.0.0.1:4178**. Try the interactive demo, or open a `.gil` / `.gia` file.

1. Start with **All findings**, or search for a graph or variable.
2. Use **Trace references** to inspect the owner, composite call chain and node IDs.
3. Choose **Review fix** for a declaration; use **Variables** to rename or edit an initial value. **Review repairs** opens a batch checklist with every proposed default visible.
4. Check the change plan. Undo/redo and individual removal are available.
5. **Validate & build export**, inspect the differences, then download the patched copy and change report.

The displayed findings always describe the original file. Reopen the downloaded copy to inspect its new state. Demo data is synthetic and is not a playable stage.

## Editing support

| Operation | Supported scope |
| --- | --- |
| Missing declaration repair | Server Entity, Item, Status and Class owner graphs; direct references and resolved nested composite references |
| New declaration types | Entity/null, Integer, Boolean, Float and String; choose the initial value during individual review |
| Private variable rename | Declaration plus exclusive direct Get/Set name inputs, with complete coverage, no name-change listener and no other node storing the name as text |
| Initial-value editing | Supported scalar declarations; unrelated dynamic references do not prevent an explicit declaration-local edit |
| File comparison | Match graph identities; show changed graph records, node counts and variable declarations |
| Save/import plan | JSON plan bound to the exact original file by SHA-256; imported operations are fully revalidated |

Composite references belong to the **calling owner graph**. A missing `EquipIdx` used in a shared composite can therefore be repaired by adding a declaration to `Medal Equipment`, while leaving every shared body unchanged. That motivating case is verified against a real stage.

Lists, structures and other types are inspected; the tool does not synthesize their initial storage. A rename can be available for those existing types when all references are direct and complete. Public/exposed variables and names used through shared composites are not renamed.

## What a repair means

A missing declaration may be a typo, and the intended initial value cannot be inferred from a type alone. Review names and defaults before accepting them. Editing a declaration's initial value does not migrate existing saved data; exposed per-entity overrides may also take precedence.

Runtime-computed names remain unresolved. Unknown dependencies, recursion, conflicting metadata and scan limits stop inferred repairs. A graph-variable-change listener prevents automatic renaming because downstream comparisons may use the old name. A rename is also refused when another node stores the name as text, which the rename would leave unchanged. External Lua/scripts are not analyzed.

Graph-variable types come from the file itself: each Get/Set node records its value type, which must agree with the kernel types observed in editor-saved stages. Nodes are shown by index and type number.

This is a focused **graph-variable workbench**, not a complete stage validator. Informational unused variables and uncalled composites are not deleted. Timer/signal renaming, geometry editing, saved-player-data migration and automatic gameplay logic changes are outside this release.

## File handling

- No backend, uploads, accounts, analytics, external fonts or remote runtime scripts.
- Workers read the file in memory; edits produce a separate download. The original bytes are never mutated.
- Targeted protobuf edits preserve untouched fields, their order and their original encoding. There is no whole-file schema reserialization.
- Every batch revalidates eligibility, reparses output, checks postconditions and compares untouched graph bytes before export.
- Inputs are limited to 32 MB. Graph count, physical/expanded node counts, nesting and worker time are bounded. Long operations can be cancelled.

Reports and saved plans contain selected graph/variable names, initial values and file fingerprints. Review those documents before sharing them. Original exports, raw test files and generated copies are excluded from Git and the static build.

## Check and build

```sh
npm test
npm run build
# With the local server still running:
npm run test:browser
```

The browser checks use installed Chrome with a private temporary profile. Set `CHROME_PATH` if needed. They exercise a project subdirectory (`/dist/index.html`), actual downloads, plan binding, undo/redo, composite evidence, batch repairs, value edits, mobile layout and HTML-like names. No browser dependencies are installed.

Optional checks against your own exports:

```sh
npm run verify:files -- path/to/stage.gil path/to/graph.gia
npm run test:browser -- path/to/stage.gil
```

The first command checks exact no-op output and eligible rename/reverse equality in memory. The browser command also exercises batch repair exports, writing test copies only into ignored `.artifacts/browser/`. Neither modifies the input.

## Source map

| Module | Responsibility |
| --- | --- |
| `src/protobuf.mjs` | Bounded protobuf wire codec and byte-preserving edits |
| `src/kernels.mjs`, `tools/observe-kernels.mjs` | Graph-variable kernel types observed in editor-saved stages, and the tool that records them |
| `src/reader.mjs` | Graphs, interfaces, normalized edges and identities |
| `src/analyze.mjs` | Caller-scoped reference tracing and edit eligibility |
| `src/values.mjs` | Scalar validation and native value storage |
| `src/patch.mjs` | Atomic operations, output checks and change reports |
| `src/compare.mjs`, `src/recipe.mjs` | Graph comparison and file-bound plans |
| `src/worker.mjs`, `src/app.mjs` | Background processing and the browser interface |
| `src/demo.mjs`, `tests/` | Source-generated fixtures and regression checks |

The format and safety contract is documented in [docs/FORMAT.md](docs/FORMAT.md). Changes are in [CHANGELOG.md](CHANGELOG.md).

## License

MIT licensed. An independent creator project, not affiliated with or endorsed by the game's developer.
