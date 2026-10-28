# Verification evidence

Status on **2026-10-28**, version **0.3.0**. File-level and browser checks pass. Native **7.1.0 Entity scalar edits pass** the disposable runtime probe, and 0.3.0 reproduces that probe's patched output byte for byte. Direct GIA import is also accepted. The remaining native scopes are listed below; this is not blanket compatibility certification.

## Automated regression checks

**40 tests pass; static build passes.** Tests cover byte-exact no-op output; direct and nested composite owner repairs; preservation of shared bodies; caller input precedence; mutable-name refusal; rename restrictions, including names stored as text by other nodes; listeners; supported server categories; scalar bounds and values; unknown-field preservation; saved-plan binding/revalidation; graph comparisons; value types recorded on nodes, kernel agreement and per-file kernel consistency; and malformed metadata, mappings, identities, type conflicts, recursion and the exact expanded-scan budget boundary.

Five zero-value storage fixtures originated in a native historical **6.2.0** export. The 7.1.0 runtime probe below verifies those five initial values in an Entity owner.

Graph-variable kernel types in `src/kernels.mjs` were recorded by `tools/observe-kernels.mjs` from the three real stages below: 43 kernels across 2,123 Get/Set nodes, each with a single value type. They include every repairable scalar type for both Get and Set.

## Real stage checks

Three local source files were read without modification. Raw files, generated copies, local paths and account metadata are excluded from Git and the static build.

| Fixture | Graph records | Composite bodies | Physical nodes | Declaration repairs | Untouched graph records |
| --- | ---: | ---: | ---: | ---: | ---: |
| Composite-heavy stage | 612 | 500 | 6,024 | 2 in one owner | 611 |
| Large stage | 69 | 0 | 27,595 | 6 in three owners | 66 |
| Brawl stage | 132 | 78 | 2,418 | 0 | 132 |

All three pass exact no-op round trips and eligible rename/reverse equality with 0.3.0. The composite-heavy stage's repairs add `PlayerEntity` (Entity/null) and `EquipIdx` (Integer/zero) to the Item owner `Medal Equipment`. All **500 shared composite bodies remain byte-identical**. The brawl stage had no missing-declaration repair candidates; it is not described as free of every possible issue.

The large stage's six reviewed-test declarations remove structural missing-name warnings. Their defaults and gameplay intent still need a creator's review, particularly persistence-related names. Test copies are not automatically approved production saves.

Compared with 0.2.0 on the same files, 0.3.0 reports the same findings, coverage, repair candidates and editable initial values, and its repair exports are byte-identical. Rename is now held back for 9 of 109 previously eligible variables (2 in the composite-heavy stage, 7 in the large stage) because another node stores the variable's name as text.

Earlier v0.1 evidence also includes four native GIA assets (136, 159, 36 and 37 nodes), two GIL stages (0 and 114 nodes), and a generated 47-node GIA with exact no-op preservation and rename/reverse equality.

## Real browser workflow

The isolated Chrome regression run passes against the built site at `/dist/index.html`:

- Worker loading, graph/variable search, filters and navigation.
- Declaration and rename review, collision refusal and atomic mixed export.
- Actual binary/report downloads with SHA-256 verification and reimport.
- Undo/redo, plan download/import, exact source mismatch refusal and clearing/restoring plans.
- Explicit unchecked batch review, initial-value editing and before/after comparison.
- Composite evidence paths and reverse caller navigation.
- Malformed input retaining the existing workspace and HTML-like names rendered as text.
- Mobile width 390 with no horizontal overflow.
- All three real source files loaded through the browser. The two- and six-repair downloads matched the engine's expected output exactly; the third offered no false missing-declaration repair. All source bytes remained unchanged.

There were **zero application errors and zero external network requests** in the complete workflow. Browser receipts, screenshots and test downloads remain in ignored `.artifacts/browser/`.

## Native 7.1.0 qualification

The installed game reports **7.1.0**. A disposable probe graph had five scalar declarations deliberately removed, then repaired by the real patch engine. The same batch renamed one private variable and changed four initial values. The exact patched GIA graph bytes were placed into a copied stage and hash-checked; the protected source stage remained unchanged.

Run `cca62f28-21cb-4c04-8ce3-24587666dda6` imported, saved and played that GIL with version 0.2.0. All **13 expected print markers** appeared; no `MF_FAIL` marker appeared. The runtime checked null Entity (then assigned/read self), zero Integer, false Boolean, zero Float and empty String; the renamed variable retained 17. Edited values were −2,147,483,648, true, 1.5 and `MF_TEXT`. Screenshots at 3 and 6 seconds were inspected and show the disposable stage running. This is a correctness check, not a load/performance measurement.

Version 0.3.0 applied the same ten operations to the same input and produced a **byte-identical** patched GIA, so this runtime result applies to 0.3.0 output for that batch.

The same patched GIA was separately imported through the official asset manager into another blank disposable save. Importing it as an **Entity node graph** completed and displayed the success notice. After saving, both native GILs retained all ten declarations' names, types and initial values. Native saves changed graph encoding, so **native graph byte identity is not claimed**; the tool's own untouched-byte guarantee remains separate.

The redacted, machine-readable [native receipt](native-7.1-evidence.json) records input/output graph fingerprints, operations, assertions and remaining gates. A successful probe does not mean an arbitrary downloaded output has been tested: each change report correctly retains `nativeEditorImport: "not-tested"` for that particular output.

| Native scope | Result |
| --- | --- |
| Entity scalar declaration repairs, rename and initial-value edits in GIL | Runtime assertions pass |
| Direct patched GIA import and native saving | Accepted; all ten declarations preserved |
| Native GIA export/reimport and execution | Pending |
| Shared-composite caller ownership | Probe prepared; runtime pending |
| Item, Status and Class owners | File-level tests pass; runtime pending |
| Full behavior of the three supplied stages | Not qualified; creator review still required |

An interrupted native GIA export attempt is not counted as evidence. The prepared composite test makes Entity and Item owners call the same original `Cache EquipIdx` body with 31 and 64, then rechecks the Entity value to test scope isolation. Its body remains byte-identical, and 0.3.0 produces the same prepared file byte for byte. It must still run before claiming that native behavior.

The app contains no game automation.
