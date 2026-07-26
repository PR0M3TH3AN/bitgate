# Reference Map

BitVid and BitRoad are **read-only reference repositories**.
This repo must not import their source trees.

## Pinned reference commits

| Repo | Short | Full |
| --- | --- | --- |
| BitVid | `726c0d26` | `726c0d26ed98bf08e923ab895d23d0b5ac9ae173` |
| BitRoad | `bcd6c8e` | `bcd6c8efbd142d8923e7d4110432bdfa0a6cd2a2` |

Pinned on 2026-07-26 from local checkouts under `/home/user/Documents/GitHub/`.

## Behavioral references (BitVid)

| Topic | BitVid path |
| --- | --- |
| Identifier / event ID helpers | `js/adminEventBlacklistHelpers.js` |
| Access control / roles | `js/accessControl.js` |
| Admin list persistence | `js/adminListStore.js` |
| Community blacklist batching | `js/adminListBatch.js` |
| Trust seeds | `js/services/trustBootstrap.js` |
| Report / mute aggregation | `js/services/moderationService.js` |
| Threshold / utility helpers | `js/services/moderationUtils.js` |
| Video presentation mapping | `js/services/moderationDecorator.js` |

## Structural references (BitRoad)

| Topic | BitRoad path |
| --- | --- |
| Address coordinates | `src/commerce/address.mjs` |
| Storefront replaceables | `src/commerce/storefronts.mjs` |
| Product replaceables | `src/commerce/product.mjs` |

## Extraction rule

Copy **behavior via fixtures and characterization**, not live imports.
Package source that imports BitVid/BitRoad fails `npm run check:references`.
