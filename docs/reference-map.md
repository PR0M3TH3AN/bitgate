# Reference Map

## Pinned Versions

- **BitVid:** `4525c1c` (2026-07-26)
- **BitRoad:** `bcd6c8e` (2026-07-26)

## Core Module References

| Module | BitVid Source | BitRoad Source | Purpose |
|--------|---------------|----------------|---------|
| identifiers | - | `src/commerce/address.mjs` | Coordinate parsing |
| targets | `js/services/moderationUtils.js` | `src/commerce/storefronts.mjs` | Addressable target model |
| authority | `js/accessControl.js` | - | Role resolution |
| policy | `js/services/moderationService.js` | - | Threshold handling |

## License Provenance

BitVid is licensed under GPL-3.0-or-later. This repository contains:

- **Original work:** New architecture, neutral target model
- **Derivative work:** Behavior extracted from BitVid fixtures
- **Reference-only:** BitRoad address semantics

Consult `docs/license-and-provenance.md` for detailed audit trails.