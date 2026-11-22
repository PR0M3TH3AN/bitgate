# Vectors copied from NSWP

These files are copied unchanged from the NSWP repository
(`PR0M3TH3AN/Nostr-Spatial-Web-Protocol--NSWP-`). NSWP releases its `vectors/`
under CC0 1.0. They hold BitGate's readers to NSWP's own definition, so the
two cannot drift apart without a test failing.

| File | NSWP path | NSWP commit | sha256 |
| --- | --- | --- | --- |
| `lists.json` | `vectors/lists.json` (NSWP-08, lists of worlds, with `choosing`) | `2050ce6d2e1eca18e845c8c4ffe8acaa8feaba04` | `2d0e39ee32c6c600ae130806e18db94392b64c1dde93259cde61a690a8567e9e` |

To update: copy the newer file from NSWP, then change the commit and hash in
this table. `tests/vectors/curation-sets.test.js` checks the hash, so a file
changed without updating the table fails.
