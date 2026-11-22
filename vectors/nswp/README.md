# Vectors copied from NSWP

These files are copied unchanged from the NSWP repository
(`PR0M3TH3AN/Nostr-Spatial-Web-Protocol--NSWP-`). NSWP releases its `vectors/`
under CC0 1.0. They hold BitGate's readers to NSWP's own definition, so the
two cannot drift apart without a test failing.

| File | NSWP path | NSWP commit | sha256 |
| --- | --- | --- | --- |
| `lists.json` | `vectors/lists.json` (NSWP-08, lists of worlds, with `choosing`) | `7c7111863a6665d97f3663c053395a9bdc819307` | `14e761ae5592632c9961b78b206e41efc9ead00e8a2bbec405ce6af16bb4e57b` |

To update: copy the newer file from NSWP, then change the commit and hash in
this table. `tests/vectors/curation-sets.test.js` checks the hash, so a file
changed without updating the table fails.
