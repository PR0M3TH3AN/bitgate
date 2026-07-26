# License and Provenance

## Source Licenses

- **BitVid:** GPL-3.0-or-later
- **BitRoad:** MIT

## Derived Works

This repository combines:

1. **Original architectural work** (MIT)
   - Workspace structure
   - Core target model
   - Policy engine design

2. **GPL-encumbered behavior** (must remain GPL-compatible)
   - BitVid moderation thresholds
   - Trust seed behavior
   - Report aggregation rules

3. **MIT-licensed reference concepts**
   - BitRoad addressable targets
   - Storefront/product identifiers

## Compliance Strategy

- Core policy engine is MIT-licensed original work
- BitVid-compat adapter is GPL-3.0-or-later
- Clear separation between:
  - Generic governance interfaces (MIT)
  - BitVid-specific behavior (GPL)

## Audit Trails

All extracted behavior is documented in:

- `fixtures/bitvid/` (input/output pairs)
- `docs/reference-map.md` (source locations)
- Commit history (clean room steps)