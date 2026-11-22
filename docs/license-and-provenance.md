# License and Provenance

## License

BitGate is **MIT** ([`LICENSE`](../LICENSE)), from 2026-11-21. Every package's
`license` field says the same, and so do the banners on the built
`bitgate.js` files.

Before that date the repository was GPL-3.0-or-later. Copies taken under the
GPL before the change keep the terms they were taken under. Everything from
the relicense commit onward is MIT.

## Why the change could be made

The owner decided it on 2026-11-21. BitLogin, BitPortal and the NSWP kit are
MIT, and GPL code could not be vendored into them.

GPL code can only be relicensed by the people who hold its copyright. Two
bodies of work matter here, and the record was checked from git history before
the change (not a legal opinion):

- **BitGate itself.** Every commit is the owner's.
- **BitVid** (GPL-3.0-or-later), whose moderation behaviour BitGate was
  characterized from: thresholds, trust seeds, admin lists, report
  deduplication, mute expiry, and evaluator precedence. Its human authors are
  the owner, under two names; the second name uses the owner's own email
  addresses. One other person made a single commit, about video playback
  (webtorrent), which nothing here derives from. The remaining commits are
  automated agents working on the owner's behalf.

No file in this repository came from another person under the GPL.

**BitRoad** is MIT and is used only as a target and model reference.

## Rules that still apply

- No direct imports from BitVid or BitRoad source trees. This is enforced by
  `scripts/verify-no-reference-imports.mjs`, part of `npm run lint`.
- Fixtures copied into this repository record their source in their README or
  metadata.
- Code from anyone other than the owner, brought in from another project, is
  checked for its licence first. Anything that isn't MIT-compatible stays out.
- One root licence; packages do not carry their own different licences.
