# Vectors copied from NSWP

These files are copied unchanged from the NSWP repository
(`PR0M3TH3AN/Nostr-Spatial-Web-Protocol--NSWP-`). NSWP releases its `vectors/`
under CC0 1.0. They hold BitGate's readers to NSWP's own definition, so the
two cannot drift apart without a test failing.

| File | NSWP path | NSWP commit | sha256 |
| --- | --- | --- | --- |
| `lists.json` | `vectors/lists.json` (NSWP-08, lists of worlds) | `a6e3c68c8b447545553803edd96735cb902f2813` | `3957a2e35d04f7e33e97ed54d758080b79fd5bea90cbca16a7e36e8256d74db3` |

To update: copy the newer file from NSWP, then change the commit and hash in
this table. `tests/vectors/curation-sets.test.js` checks the hash, so a file
changed without updating the table fails.
