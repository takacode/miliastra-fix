# File and patch contract

## Container and discovery

The header consists of five big-endian 32-bit values: file length minus four, schema `1`, marker `0x326`, format `2` (GIL) / `3` (GIA), and payload length. The protobuf payload starts at byte 20 and ends before the four-byte `0x679` trailer. Patches recompute the two lengths and retain other container fields.

These paths use protobuf **field numbers**. Actual edits address each occurrence by its physical field index so repeated wrappers remain distinct.

| Record | Path |
| --- | --- |
| GIL ordinary graphs | `10.1[].1` |
| GIL composite bodies | `10.4[].1` |
| GIL interfaces | `10.2[].1` |
| GIA graph asset/dependencies | `(1|2)[].13.1.1` |
| GIA interfaces | `(1|2)[].14.1.1` |
| Graph identity/name/nodes/mappings/variables | `1 / 2 / 3[] / 4[] / 6[]` |
| Declaration name/type/value/exposed | `2 / 3 / 4 / 5` |
| Node index/shell/kernel/pins | `1 / 2 / 3 / 4[]` |
| Pin shell/kernel/value/type/edges/UID | `1 / 2 / 3 / 4 / 5[] / 7` |
| Interface shell/kernel/body | `4.1 / 4.2 / 4.4` |
| Interface in-flow/out-flow/inputs/outputs | `100[] / 101[] / 102[] / 103[]` |
| Interface port signature/UID | `3 / 8` |

Locators are matched by all of origin, service, kind and runtime ID. Ordinary owners have origin `10000`, kind `21001`; supported server services are `20000` Entity, `20003` Status, `20004` Class and `20005` Item. Composite bodies have kind `21002`. Composite call shells are interface locators, typically origin `10001`, kind `22001`.

## Reference analysis

Get Graph Variable shell `337` and Set Graph Variable shell `323` take their name at data input slot zero. Their value pin records the reference type. The kernel must agree with the types observed in editor-saved stages (`src/kernels.mjs`, regenerated with `tools/observe-kernels.mjs`): a scalar type requires an observed kernel, and one kernel cannot carry two types within a file. Stored values, including nested polymorphic actual values, must match that type. Shell `351` is the graph-variable-change listener. Other built-in nodes (origin `10001`, service `20000`, kind `22000`) do not address graph variables by name; a call without a resolvable composite definition leaves coverage incomplete.

Flow/data edges are normalized from either endpoint and deduplicated as full edges. Flow inputs accept flow outputs; data inputs accept data outputs. Duplicate nodes, declarations, pins or graph identities prevent inferred changes. Supplied kernel pin signatures and persistent interface identities are checked for disagreement. Generic nodes may legitimately relocate shell/kernel slots; they are not globally required to match.

Each owner is analyzed separately. Composite interfaces map to exact bodies; body variable references retain the **outer owner's scope**. Exposed body input mappings take precedence over stored fallback literals, and caller inputs are resolved recursively. Multiple wires, unresolved outputs and runtime computations leave coverage incomplete. The initial value of a mutable graph variable is never treated as a constant name source.

Repeated call sites deduplicate a physical variable reference by body, node, name and type while retaining occurrence counts and up to eight example call paths. Dependencies and reverse owner links are exposed in the UI. A composite body is never patched directly.

Interface implementation categories `1001–1005` represent signal and structure operations, not graph-variable access. Their metadata pins use a separate schema and are not treated as composite flow/data ports.

Cycles, nesting beyond 32 composite levels, name traces beyond 64 steps, and more than 50,000 expanded node visits per owner result in **incomplete coverage**. Reaching the budget at a final composite call cannot silently omit its body. Files also have byte, record, field and physical-node bounds; the browser worker has a 45-second timeout and cancellation.

## Operations

`declare` requires complete owner coverage, a missing name, consistent reference types and one of the five supported scalar types. It appends a private field-6 declaration to the owner only. Default null/zero/false/empty storage follows observed native encodings; an explicit initial value can be supplied. A Set node's runtime value is not used as the initializer.

`rename` requires complete coverage, no graph-variable-change listener, a private declaration, exclusively direct name literals belonging to that owner, and no other built-in node in the owner's scan storing the name as text. It replaces the declaration name and those exact Get/Set name fields. Shared/forwarded references are refused. External Lua and scripts remain outside the analysis; the review makes this scope explicit. Names cannot collide with declared names, unresolved declaration references or other rename targets. Rename cycles are not supported.

`set-default` is declaration-local and does not require all runtime names to be resolved. It requires an unambiguous owner/declaration and supported value encoding without a known reference type conflict. It changes the scalar body and value-set flag, retaining unknown value/storage fields. Exposed variables can have per-entity overrides; existing saves can take precedence. No saved-data migration occurs.

Names use a conservative tool limit of 1–128 UTF-8 bytes without controls or surrounding spaces. Integers are signed 32-bit; floats are finite Float32 values; strings are limited to 4,096 UTF-8 bytes without null characters. Only null Entity initial values are authored. Lists, structures and dictionaries are not synthesized.

## Atomic export and supporting tools

All operations are checked against the original bytes inside the engine, not merely in the interface. One operation per variable is allowed in a batch. A batch either validates completely or returns no output. Input arrays are not mutated.

After patching, the engine reparses the file and checks graph inventory, physical node counts, declaration counts, coverage stability, reference counts, requested names/values and exact untouched graph bytes. The change report records individual edits, composite-body preservation and before/after SHA-256 fingerprints. Native editor import remains a separate qualification field.

Saved plans include a schema version, exact source fingerprint and cleaned operations. Import validates the fingerprint and performs a full dry patch before loading the plan. Imported claims of approval or safety are not trusted. Undo/redo applies to up to 100 plan edits, never to the source file.

File comparison matches full graph identities and compares raw graph records. It itemizes declaration changes and node counts. It explicitly does **not** itemize scene/resource/mount changes; byte-different files with identical graphs are not called identical.

## Limits of the evidence

Wire validity and intended byte edits do not prove gameplay intent, native import acceptance, or complete external reference discovery. A missing declaration can be a typo. Unused-variable information is not proof of dead code. There is no delete-unused or automatic gameplay rewrite operation. Current qualification is recorded in [VERIFICATION.md](VERIFICATION.md).
