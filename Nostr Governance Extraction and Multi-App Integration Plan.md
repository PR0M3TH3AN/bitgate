# Nostr Governance Extraction and Multi-App Integration Plan

**Source application:** BitVid
**First consumer:** BitVid
**Second validation consumer:** BitRoad
**Target repository:** `PR0M3TH3AN/nostr-governance`
**Implementation style:** ESM JavaScript with strict JSDoc and generated type declarations
**Migration strategy:** Characterize → extract → shadow → cut over → validate in BitRoad
**Status:** Proposed master development plan
**Baseline reviewed:** BitVid `4525c1c`; BitRoad `bcd6c8e`

---

# 1. Executive Summary

BitVid currently contains a substantial reusable governance system:

* User allowlists
* User denylists
* Event denylists
* Super-admin authority
* Delegated moderators
* Community-curated blacklists
* NIP-56 report aggregation
* NIP-51 trusted-mute aggregation
* Web-of-trust scoring
* Adjustable moderation thresholds
* Viewer blocks and overrides
* Anonymous-user trust seeds
* Nostr-backed administration
* Cached fallback state
* Batched subscriptions and evaluation

These capabilities should be extracted into a standalone, headless repository named:

```text
nostr-governance
```

The repository should become a reusable governance SDK for Nostr applications. It will determine:

* Who is authorized to administer an application
* Which users or events are allowed or denied
* Which community actors may contribute moderation lists
* Which reports and mutes are trusted
* Which policy effects apply to a target
* Why a decision was made

It will not determine:

* How a warning looks
* Whether a BitVid thumbnail is blurred
* How a BitRoad product card is styled
* Which modal opens
* Which toast appears
* How a feed or marketplace rerenders
* What application-specific wording is shown

The fundamental division is:

```text
Nostr Governance
    decides:
    "This target is downranked, restricted, hidden, or denied."

Consuming application
    decides:
    "This means blur the thumbnail, disable checkout,
     collapse the post, or hide the product."
```

BitVid will be the first consumer because its existing behavior provides the reference implementation and conformance suite.

BitRoad will be the second consumer because its sellers, storefronts, products, reviews, and checkout surfaces exercise the generic user, event, and addressable-target model. BitRoad currently uses `kind:30078` parameterized-replaceable events for storefronts and products, making address-level governance especially valuable.

---

# 2. Current System Baseline

## 2.1 Current BitVid behavior

BitVid is follow-centric and performs client-side, user-controlled moderation with optional administrative lists. Its documentation explicitly separates creator access controls from trust-graph moderation.

The current system includes:

* NIP-56 reports
* NIP-51 mute lists
* Administrative user lists
* Administrative event lists
* Viewer blocks
* Trusted contacts
* Default trust seeds
* Threshold-based policy decisions
* Viewer overrides
* Feed-specific enforcement exceptions

### Current default thresholds

The reviewed BitVid configuration uses:

```text
Trusted report blur threshold:       3
Trusted report autoplay threshold:   3
Trusted mute hide threshold:        20
Trusted spam-report hide threshold:  5
Trusted mute validity window:       60 days
```

These values are BitVid defaults, not universal governance defaults. The extracted system must let each application provide its own policy.

## 2.2 Current trusted-mute behavior

Trusted mutes below the hide threshold are ranking signals only.

A trusted mute below the threshold must:

* Downrank the author
* Not blur content
* Not block playback
* Not produce a public warning badge
* Not be interpreted as an administrative denial

At the trusted-mute threshold, the decision escalates to a reversible hide. This recent distinction must be preserved during extraction.

## 2.3 Current report behavior

Trusted reports are counted from the viewer’s trusted graph. Report thresholds can:

* Blur content
* Prevent automatic interaction
* Hide content at a higher threshold
* Produce evidence explaining the decision

Reports must be deduplicated by reporter, and reports from muted or blocked reporters must not count.

## 2.4 Current trust seeds

For anonymous or default visitors, BitVid derives trust seeds from:

* The super admin
* Active moderators

Static configured seeds are fallback values when the live administrative state cannot be loaded. Changes to moderators or the blacklist cause the trusted-seed state to be reapplied.

## 2.5 Current community blacklist federation

BitVid supports community-curated blacklist sources without granting those curators full moderator authority.

The super admin publishes references to curator lists. BitVid fetches those lists, merges the entries, removes duplicates, and protects administrators from being added to the effective blacklist.

This distinction should become a formal capability in the extracted authority model:

```text
Curator:
    can contribute a limited list

Moderator:
    can perform application-approved governance actions

Super admin:
    can grant roles and change policy
```

## 2.6 Current performance behavior

The extraction must preserve recent BitVid performance improvements:

* NIP-56 reports are fetched through batched active-event subscriptions.
* Large event sets are divided into bounded filter chunks.
* Author moderation information is evaluated in batches.
* Trusted-contact changes emit only when the graph actually changes.
* Community list references are retrieved in a batch.

BitVid currently chunks report targets in groups of 200 rather than opening one subscription per video.

The batch-author optimization previously reduced a large-feed moderation benchmark by approximately 50%, so the extracted runtime must not regress to per-item store lookups.

## 2.7 Current policy duplication

Policy is currently calculated in more than one BitVid layer.

`createModerationStage()` determines:

* Trusted report counts
* Trusted mute counts
* Viewer blocks
* Administrative status
* Hide thresholds
* Feed-policy bypasses
* Overrides
* Blur state
* Interaction restrictions

`ModerationDecorator` then performs overlapping calculations while decorating video objects.

The extracted system must establish one canonical policy evaluator.

The feed stage and decorator must consume its decision rather than reimplementing policy.

---

# 3. Goals

The extracted repository must:

1. Preserve current BitVid behavior during migration.
2. Support other Nostr applications without importing BitVid concepts.
3. Treat users, immutable events, and addressable events as first-class targets.
4. Provide deterministic and explainable governance decisions.
5. Formalize super-admin, moderator, and curator authority.
6. Support capability-based delegation.
7. Support arbitrary application report categories.
8. Support adjustable, application-defined policies.
9. Support multiple policy profiles within one application.
10. Keep Nostr transport and signing injectable.
11. Keep storage injectable.
12. Work in browsers, workers, Node.js, and tests.
13. Support anonymous and authenticated viewers.
14. Support personal blocks and viewer overrides.
15. Support batched evaluation and bounded subscriptions.
16. Preserve legacy BitVid events during migration.
17. Provide a stable public SDK for BitVid, BitRoad, and future consumers.
18. Permit an optional hosted HTTP adapter without requiring one.

---

# 4. Non-Goals

The initial extraction will not include:

* BitVid CSS
* BitVid design tokens
* Video-card components
* Thumbnail blur implementation
* Playback controls
* Profile-modal UI
* DOM event dispatch
* Toast messages
* Feed rendering
* BitRoad product-card components
* BitRoad checkout UI
* Storefront themes
* Framework-specific React, Vue, or web components
* A mandatory hosted moderation server
* Appeals or dispute-resolution policy
* Enforcement outside compatible clients

The project is a governance engine and synchronization SDK, not a complete moderation product.

---

# 5. Resolved Architectural Decisions

## 5.1 Repository name

Use:

```text
PR0M3TH3AN/nostr-governance
```

The name is broad enough for:

* Moderation
* Access control
* Trust
* Delegation
* Administrative policy
* Community curation
* Commerce restrictions

## 5.2 Headless first

The first stable release contains no UI components.

Optional UI-controller or component packages may be considered after BitVid and BitRoad both consume the headless runtime successfully.

## 5.3 JavaScript before TypeScript conversion

Begin with:

* ESM JavaScript
* Strict JSDoc
* Type checking
* Generated `.d.ts` declarations

Do not combine behavioral extraction with a complete TypeScript rewrite. A TypeScript conversion can occur after parity is established.

## 5.4 SDK before HTTP

The primary interface is a JavaScript SDK.

An HTTP or Cloudflare Worker adapter may be added later using the same SDK internally.

## 5.5 Capability-based authority

Applications check capabilities, not hardcoded role names.

Do not expose a universal method such as:

```js
isAdminEditor()
```

as the principal authority model.

Expose:

```js
governance.can(actorPubkey, capability, target);
```

## 5.6 Addressable targets are mandatory

A governance system for BitRoad cannot rely only on immutable event IDs.

BitRoad products and storefronts can be replaced while retaining their address coordinate. A blocked product must not evade governance merely by publishing a new revision.

## 5.7 One canonical evaluator

All policy effects must be produced by one pure evaluator.

Application adapters may translate a decision, but they may not recalculate the underlying policy.

## 5.8 Wire schema and package version are separate

A package update must not silently change which Nostr events are authoritative.

Track separately:

```text
Package version:      0.4.2
Event schema version: 1
Policy version:       bitvid-2026-07
```

---

# 6. Target Repository Structure

```text
nostr-governance/
├── package.json
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── targets.js
│   │   │   ├── identifiers.js
│   │   │   ├── authority.js
│   │   │   ├── policy.js
│   │   │   ├── evaluator.js
│   │   │   ├── decisions.js
│   │   │   └── snapshots.js
│   │   └── package.json
│   │
│   ├── nostr/
│   │   ├── src/
│   │   │   ├── transport.js
│   │   │   ├── signer.js
│   │   │   ├── codecs/
│   │   │   │   ├── canonical-v1.js
│   │   │   │   ├── bitvid-legacy.js
│   │   │   │   ├── nip51.js
│   │   │   │   └── nip56.js
│   │   │   ├── event-selection.js
│   │   │   └── verification.js
│   │   └── package.json
│   │
│   ├── runtime/
│   │   ├── src/
│   │   │   ├── GovernanceRuntime.js
│   │   │   ├── GovernanceAdminStore.js
│   │   │   ├── TrustGraphStore.js
│   │   │   ├── ReportStore.js
│   │   │   ├── TrustedMuteStore.js
│   │   │   ├── PolicyStore.js
│   │   │   ├── OverrideStore.js
│   │   │   └── commands/
│   │   └── package.json
│   │
│   ├── storage/
│   │   ├── src/
│   │   │   ├── memory.js
│   │   │   ├── localStorage.js
│   │   │   └── indexedDb.js
│   │   └── package.json
│   │
│   ├── bitvid-compat/
│   │   ├── src/
│   │   │   ├── accessControlFacade.js
│   │   │   ├── moderationServiceFacade.js
│   │   │   ├── legacyCache.js
│   │   │   └── videoDecisionAdapter.js
│   │   └── package.json
│   │
│   └── testing/
│       ├── src/
│       │   ├── FakeTransport.js
│       │   ├── FakeSigner.js
│       │   ├── FakeStorage.js
│       │   ├── FakeClock.js
│       │   └── fixtures/
│       └── package.json
│
├── examples/
│   ├── vanilla-browser/
│   ├── node-runtime/
│   ├── bitvid-adapter/
│   └── bitroad-adapter/
│
├── docs/
│   ├── architecture.md
│   ├── authority-model.md
│   ├── event-schema-v1.md
│   ├── policy-guide.md
│   ├── migration-from-bitvid.md
│   └── consumer-integration.md
│
└── .github/workflows/
```

Recommended package names:

```text
@nostr-governance/core
@nostr-governance/nostr
@nostr-governance/runtime
@nostr-governance/storage
@nostr-governance/bitvid-compat
@nostr-governance/testing
```

Do not create a BitRoad-specific package initially. Build the first BitRoad adapter inside BitRoad or as an example. Only create `@nostr-governance/bitroad` if multiple applications later need the exact same commerce mappings.

---

# 7. Domain Model

## 7.1 Governance targets

```ts
type GovernanceTarget =
  | {
      type: "user";
      pubkey: string;
    }
  | {
      type: "event";
      eventId: string;
      author?: string;
      kind?: number;
    }
  | {
      type: "address";
      coordinate: string;
      author?: string;
      kind?: number;
    };
```

### User target

Used for:

* BitVid creators
* BitRoad sellers
* Review authors
* Community curators
* Reporters

### Event target

Used for:

* One exact video note
* One exact report
* One immutable review
* One event that should remain denied regardless of its author

### Address target

Used for:

* A replaceable BitVid video coordinate
* A BitRoad product across revisions
* A BitRoad storefront
* An article
* A playlist
* An application-specific object identified through an `a` coordinate

## 7.2 Target keys

```ts
function governanceTargetKey(target): string;
```

Canonical forms:

```text
user:<hex-pubkey>
event:<hex-event-id>
address:<kind>:<hex-pubkey>:<d-tag>
```

Every cache, override, evidence record, and decision must use a canonical target key.

## 7.3 Policy decision

```ts
interface GovernanceDecision {
  target: GovernanceTarget;
  key: string;

  ranking: {
    effect: "normal" | "downrank";
    weight: number;
  };

  visibility: {
    effect: "allow" | "warn" | "restrict" | "hide" | "deny";
    overridable: boolean;
  };

  interaction: {
    effect:
      | "allow"
      | "require-explicit-action"
      | "deny";
  };

  transaction?: {
    effect:
      | "allow"
      | "require-review"
      | "deny";
  };

  reasons: GovernanceReason[];
  evidence: GovernanceEvidence;

  policyProfile: string;
  policyVersion: string;
  snapshotFingerprint: string;
  evaluatedAt: number;
}
```

The optional `transaction` dimension is useful for commerce applications.

A product may be:

* Visible
* Inspectable
* Downranked
* Prevented from checkout

without conflating all of those states into one `hidden` boolean.

## 7.4 Stable reason identifiers

```text
viewer-block
viewer-mute
viewer-override
admin-user-deny
admin-event-deny
admin-address-deny
community-user-deny
trusted-report
trusted-report-threshold
trusted-mute
trusted-mute-threshold
allowlist-miss
protected-target
surface-policy-bypass
policy-disabled
```

Applications map these identifiers to their own wording.

## 7.5 Governance evidence

```ts
interface GovernanceEvidence {
  trustedReportTotal: number;
  trustedReportsByCategory: Record<string, number>;
  trustedReporterPubkeys: string[];

  trustedMuteTotal: number;
  trustedMutesByCategory: Record<string, number>;
  trustedMuterPubkeys: string[];

  personalBlock: boolean;
  personalMute: boolean;

  userDenied: boolean;
  eventDenied: boolean;
  addressDenied: boolean;

  userAllowed: boolean;
  protectedTarget: boolean;

  thresholds: {
    warn?: number;
    restrict?: number;
    hide?: number;
    deny?: number;
  };
}
```

Sensitive evidence such as reporter names should not be included automatically. Applications may resolve public profile display names separately.

---

# 8. Authority and Delegation Model

## 8.1 Current BitVid authority mismatch

BitVid currently allows moderators to invoke list mutations through `canEditAdminLists()`, but its canonical list loader scopes core list retrieval to the super-admin author. Persistence then signs with the currently active signer.

This creates an apparent distinction between:

* Being permitted by the client to request a mutation
* Being accepted as an authoritative publisher by the loader

The new repository must resolve this explicitly rather than reproducing the ambiguity.

## 8.2 Root-authorized contributor model

Use:

1. Root-signed role state
2. Actor-signed contribution lists
3. Capability-based list acceptance

The root administrator publishes the authoritative role roster.

Each authorized actor publishes their own contribution list under their own key.

The runtime:

1. Loads root role state.
2. Resolves actor capabilities.
3. Loads contributions from authorized actors.
4. Ignores contributions that exceed the actor’s capabilities.
5. Merges valid contributions.
6. Stops accepting an actor’s contributions immediately after revocation.

No moderator needs access to a shared super-admin private key.

## 8.3 Roles

Default roles:

```text
super_admin
moderator
curator
reviewer
```

Roles are convenience bundles. Capabilities remain authoritative.

## 8.4 Capabilities

```ts
type GovernanceCapability =
  | "manage-roles"
  | "manage-policy"
  | "manage-community-sources"
  | "contribute-user-allow"
  | "contribute-user-deny"
  | "contribute-event-deny"
  | "contribute-address-deny"
  | "contribute-trust-seed"
  | "review-evidence";
```

Default role mapping:

```js
const defaultRoleCapabilities = {
  super_admin: [
    "manage-roles",
    "manage-policy",
    "manage-community-sources",
    "contribute-user-allow",
    "contribute-user-deny",
    "contribute-event-deny",
    "contribute-address-deny",
    "contribute-trust-seed",
    "review-evidence",
  ],

  moderator: [
    "contribute-user-deny",
    "contribute-event-deny",
    "contribute-address-deny",
    "contribute-trust-seed",
    "review-evidence",
  ],

  curator: [
    "contribute-user-deny",
  ],

  reviewer: [
    "review-evidence",
  ],
};
```

Applications may define additional roles:

```text
seller_moderator
listing_moderator
video_moderator
review_moderator
```

## 8.5 Protected actors

The runtime must protect:

* Root administrators
* Optionally selected system accounts
* Optionally application infrastructure keys

Protected actors cannot be denied through contributor lists.

Only an authorized root-policy change may change protected status.

## 8.6 Merge policy

| State             | Authority                   | Merge behavior               |
| ----------------- | --------------------------- | ---------------------------- |
| Roles             | Root only                   | Latest valid root event      |
| Policy            | Root only                   | Latest valid root event      |
| Community sources | Root or capability holder   | Latest accepted source state |
| User allowlist    | Root by default             | Configurable                 |
| User denylist     | Authorized contributors     | Union                        |
| Event denylist    | Authorized contributors     | Union                        |
| Address denylist  | Authorized contributors     | Union                        |
| Trust seeds       | Root plus authorized actors | Union                        |
| Viewer overrides  | Local viewer                | Viewer-local                 |
| Personal blocks   | Viewer                      | Viewer-local                 |

---

# 9. Canonical Nostr Event Schema

## 9.1 General approach

The repository must use codecs so event formats remain replaceable.

The core runtime must not know:

* Which Nostr kind stores roles
* Which `d` identifier is used
* Whether entries appear in tags or content
* How a legacy BitVid event is represented

These details belong to codecs.

## 9.2 Canonical v1 kind

Use `kind:30078` for canonical governance application-data documents.

Reasons:

* Parameterized-replaceable
* Suitable for application-specific state
* Supports namespaced `d` identifiers
* Can carry structured content
* Avoids overloading a people-list kind for policies and role documents
* Already supported broadly by the user’s application stack

Legacy BitVid `kind:30000` events remain supported through the compatibility codec.

## 9.3 Canonical identifiers

```text
<namespace>:governance:roles:v1
<namespace>:governance:policy:v1
<namespace>:governance:user-allow:v1
<namespace>:governance:user-deny:v1
<namespace>:governance:event-deny:v1
<namespace>:governance:address-deny:v1
<namespace>:governance:community-sources:v1
```

Examples:

```text
bitvid:governance:roles:v1
bitvid:governance:user-deny:v1
bitroad:governance:address-deny:v1
```

## 9.4 Common tags

```json
[
  ["d", "bitroad:governance:address-deny:v1"],
  ["v", "1"],
  ["client", "nostr-governance"],
  ["scope", "address-deny"]
]
```

## 9.5 Role event

Published by a root administrator:

```json
{
  "kind": 30078,
  "content": "",
  "tags": [
    ["d", "bitroad:governance:roles:v1"],
    ["v", "1"],
    ["p", "<moderator-pubkey>", "moderator"],
    ["cap", "<moderator-pubkey>", "contribute-user-deny"],
    ["cap", "<moderator-pubkey>", "contribute-address-deny"],
    ["p", "<curator-pubkey>", "curator"],
    ["cap", "<curator-pubkey>", "contribute-user-deny"]
  ]
}
```

The exact tag layout should be finalized through test vectors before release, but it must support:

* Role labels
* Explicit capabilities
* Root protection
* Schema version
* Future extension without changing the kind

## 9.6 User contribution lists

```json
{
  "kind": 30078,
  "content": "",
  "tags": [
    ["d", "bitroad:governance:user-deny:v1"],
    ["v", "1"],
    ["p", "<seller-pubkey>", "scam"],
    ["p", "<seller-pubkey-2>", "malware"]
  ]
}
```

## 9.7 Event contribution lists

```json
{
  "kind": 30078,
  "content": "",
  "tags": [
    ["d", "bitvid:governance:event-deny:v1"],
    ["v", "1"],
    ["e", "<event-id>", "illegal"]
  ]
}
```

## 9.8 Address contribution lists

```json
{
  "kind": 30078,
  "content": "",
  "tags": [
    ["d", "bitroad:governance:address-deny:v1"],
    ["v", "1"],
    ["a", "30078:<seller-pubkey>:bitroad:product:sku-001", "malware"]
  ]
}
```

## 9.9 Policy event

```json
{
  "kind": 30078,
  "tags": [
    ["d", "bitroad:governance:policy:v1"],
    ["v", "1"]
  ],
  "content": "{\"policyVersion\":\"bitroad-1\",\"profiles\":{...}}"
}
```

Policy content must be schema-validated and size-bounded.

## 9.10 Legacy BitVid compatibility

The compatibility codec must continue reading:

```text
bitvid:admin:editors
bitvid:admin:whitelist
bitvid:admin:blacklist
bitvid:admin:event-blacklist
```

It must also read existing community blacklist source references.

Migration behavior:

```text
Stage 1: read legacy, write legacy
Stage 2: read both, write legacy
Stage 3: read both, dual-write
Stage 4: read both, write canonical
Stage 5: retain legacy reading for compatibility
```

Do not perform a destructive migration.

---

# 10. Public SDK

## 10.1 Runtime creation

```ts
createGovernanceRuntime(options): GovernanceRuntime;
```

```ts
interface CreateGovernanceRuntimeOptions {
  applicationId: string;
  namespace: string;

  rootPubkeys: string[];

  transport: GovernanceTransport;
  storage: GovernanceStorage;
  policy: GovernancePolicy;

  signer?: GovernanceSigner;
  clock?: GovernanceClock;
  codecs?: GovernanceCodec[];
  logger?: GovernanceLogger;
  cachePolicy?: GovernanceCachePolicy;
  reputationSource?: GovernanceReputationSource;
}
```

Example:

```js
const governance = createGovernanceRuntime({
  applicationId: "bitroad",
  namespace: "bitroad",

  rootPubkeys: [operatorPubkey],

  transport,
  signer,
  storage,

  policy: bitRoadPolicy,

  codecs: [
    createCanonicalGovernanceCodec({ version: 1 }),
  ],
});
```

## 10.2 Lifecycle

```ts
governance.initialize(): Promise<GovernanceSnapshot>;
governance.destroy(): Promise<void>;
```

`destroy()` must:

* Close subscriptions
* Cancel supported requests
* Clear timers
* Remove listeners
* Release viewer-sensitive state
* Clear active targets

## 10.3 Viewer state

```ts
governance.setViewer(viewer): Promise<void>;
governance.clearViewer(): Promise<void>;
```

```ts
interface GovernanceViewer {
  pubkey?: string;
  follows?: Iterable<string>;
  blockedPubkeys?: Iterable<string>;
  mutedPubkeys?: Iterable<string>;
}
```

Anonymous sessions omit `pubkey` and rely on configured trust seeds.

## 10.4 Active-target management

```ts
governance.setActiveTargets(targets): Promise<void>;
governance.addActiveTargets(targets): Promise<void>;
governance.removeActiveTargets(targetsOrKeys): Promise<void>;
governance.clearActiveTargets(): Promise<void>;
```

This API allows:

* BitVid to register videos visible in the active feed
* BitRoad to register products in the current marketplace page
* A product page to register its reviews
* An application to remove targets when a view is closed

The runtime must batch active-target report subscriptions.

## 10.5 Evaluation

```ts
governance.evaluate(
  target,
  context?
): GovernanceDecision;
```

```ts
governance.evaluateMany(
  targets,
  context?
): Map<string, GovernanceDecision>;
```

`evaluateMany()` is required for:

* Feeds
* Search results
* Marketplace grids
* Storefront catalogs
* Review lists
* Admin dashboards

Evaluation must be synchronous after runtime state has been loaded. Relay access must not occur inside an individual evaluation call.

## 10.6 Evaluation context

```ts
interface GovernanceEvaluationContext {
  surface?: string;
  policyProfile?: string;
  viewerPubkey?: string;

  enforcement?: {
    hardHide?: boolean;
    allowOverrides?: boolean;
    requireExplicitAction?: boolean;
  };

  metadata?: Record<string, unknown>;
}
```

## 10.7 Snapshot queries

```ts
governance.getSnapshot(): GovernanceSnapshot;
governance.getRoles(): GovernanceRoleSnapshot;
governance.getPolicy(): GovernancePolicySnapshot;
governance.getAdministrativeState(): GovernanceAdministrativeSnapshot;
governance.getEvidence(target): GovernanceEvidence;
governance.getUserStatus(pubkey): GovernanceUserStatus;
governance.getTargetStatus(target): GovernanceTargetStatus;
```

Returned values must be immutable snapshots or defensive copies.

Consumers must never receive internal mutable maps.

## 10.8 Capability queries

```ts
governance.can(
  actorPubkey,
  capability,
  target?
): boolean;
```

```ts
governance.getCapabilities(
  actorPubkey
): GovernanceCapability[];
```

UI may use these methods to decide which controls to show.

Commands must independently repeat authority validation before signing.

## 10.9 Administrative commands

```ts
governance.commands.grantRole(input);
governance.commands.revokeRole(input);
governance.commands.setCapabilities(input);

governance.commands.addUserAllow(input);
governance.commands.removeUserAllow(input);

governance.commands.addUserDeny(input);
governance.commands.removeUserDeny(input);

governance.commands.addEventDeny(input);
governance.commands.removeEventDeny(input);

governance.commands.addAddressDeny(input);
governance.commands.removeAddressDeny(input);

governance.commands.addCommunitySource(input);
governance.commands.removeCommunitySource(input);

governance.commands.publishPolicy(input);
```

Example:

```js
await governance.commands.addAddressDeny({
  target: productTarget,
  category: "malware",
  reason: "Download contained a malicious executable.",
  metadata: {
    storefrontAddress: product.storefrontAddress,
  },
});
```

## 10.10 Command result

```ts
interface GovernanceCommandResult {
  ok: boolean;

  commandId?: string;
  publishedEventIds?: string[];
  acceptedRelays?: string[];
  stateChanged?: boolean;

  error?: {
    code: GovernanceErrorCode;
    message: string;
  };
}
```

Stable error codes:

```text
forbidden
invalid-target
invalid-pubkey
invalid-event-id
invalid-address
protected-target
signer-unavailable
signature-failed
publish-failed
transport-unavailable
stale-state
conflict
```

## 10.11 Viewer overrides

```ts
governance.overrides.set(input): Promise<void>;
governance.overrides.clear(input): Promise<void>;
governance.overrides.clearAll(): Promise<void>;
governance.overrides.has(target): boolean;
governance.overrides.get(target): GovernanceOverride | null;
```

Supported scopes:

```text
target
author
category
```

Administrative transaction denials should not be viewer-overridable unless the application policy explicitly permits it.

## 10.12 Reports

```ts
governance.reports.create(input): Promise<GovernanceCommandResult>;
governance.reports.getSummary(target): GovernanceReportSummary;
governance.reports.getTrustedReporters(
  target,
  category?
): GovernanceReporterEvidence[];
```

The core accepts arbitrary normalized categories.

BitVid examples:

```text
nudity
spam
illegal
impersonation
malware
profanity
other
```

BitRoad examples:

```text
scam
malware
impersonation
counterfeit
non-delivery
misleading
prohibited
spam
other
```

## 10.13 Subscriptions

```ts
governance.subscribe(listener): () => void;

governance.subscribeToTarget(target, listener): () => void;
governance.subscribeToRoles(listener): () => void;
governance.subscribeToPolicy(listener): () => void;
governance.subscribeToAdministrativeState(listener): () => void;
governance.subscribeToViewerState(listener): () => void;
```

Semantic change types:

```text
initialized
viewer-changed
roles-changed
policy-changed
administrative-state-changed
trust-graph-changed
report-summary-changed
trusted-mute-state-changed
target-decision-changed
override-changed
transport-status-changed
```

Notifications must include a state fingerprint or revision so consumers can ignore duplicates.

## 10.14 Import and export

```ts
governance.exportSnapshot(options?): GovernancePortableSnapshot;

governance.importSnapshot(
  snapshot,
  options?
): Promise<GovernanceImportResult>;
```

Import modes:

```text
preview
merge
replace-local-cache
publish-authoritative-state
```

Signer secrets must never be exported.

## 10.15 Diagnostics

```ts
governance.diagnostics.getStatus(): GovernanceRuntimeStatus;
governance.diagnostics.explain(
  target,
  context?
): GovernanceDecisionTrace;
```

Example trace:

```text
viewer block: no
admin user deny: no
admin address deny: no
trusted scam reports: 2 / restrict threshold 3
trusted mute count: 1 / hide threshold 20
result: downrank
```

Sensitive relationship evidence must be restricted or omitted in production diagnostics.

---

# 11. Transport, Signer, and Storage Interfaces

## 11.1 Transport

```ts
interface GovernanceTransport {
  list(
    filters: object[],
    options?: GovernanceListOptions
  ): Promise<NostrEvent[]>;

  subscribe(
    filters: object[],
    handlers: GovernanceSubscriptionHandlers,
    options?: GovernanceSubscribeOptions
  ): GovernanceSubscription;

  publish(
    event: NostrEvent,
    options?: GovernancePublishOptions
  ): Promise<GovernancePublishResult>;
}
```

The package must not depend directly on:

* BitVid’s relay pool
* BitRoad’s `queryRelays()`
* NDK
* nostr-tools
* A particular SubscriptionManager

Each consumer provides an adapter.

## 11.2 Signer

```ts
interface GovernanceSigner {
  getPublicKey(): Promise<string>;
  signEvent(event: UnsignedNostrEvent): Promise<NostrEvent>;
}
```

This aligns with both applications’ need to support multiple signer methods.

BitRoad already separates its active signer and NIP-07, nsec, and BitLogin implementations.

## 11.3 Storage

```ts
interface GovernanceStorage {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}
```

Storage keys must be namespaced by:

```text
application ID
governance namespace
root-authority fingerprint
schema version
viewer pubkey, when viewer-specific
```

Example:

```text
nostr-governance:bitroad:bitroad:<root-fingerprint>:v1:admin
```

This prevents state from one deployment or viewer leaking into another.

---

# 12. Policy Engine

## 12.1 Policy pipeline

Canonical evaluation order:

```text
1. Validate and normalize target
2. Resolve protected-target status
3. Apply viewer personal block
4. Apply administrative user denial
5. Apply administrative event denial
6. Apply administrative address denial
7. Apply access allowlist policy
8. Apply viewer override where permitted
9. Aggregate trusted mute evidence
10. Aggregate trusted report evidence
11. Apply category thresholds
12. Apply optional reputation signal
13. Apply surface policy profile
14. Return decision and explanation
```

## 12.2 Separation of access and trust

Allowlists must remain separate from the trust graph.

Being allowed to publish or appear in an application does not make someone:

* A trusted reporter
* A moderator
* A trust seed
* Immune to moderation
* Exempt from personal blocks

This preserves BitVid’s existing separation between creator access and trust-based moderation.

## 12.3 Policy profiles

One application may enforce the same evidence differently by surface.

Example BitRoad profiles:

```js
const bitRoadPolicyProfiles = {
  "public-marketplace": {
    administrativeDeny: {
      visibility: "hide",
      transaction: "deny",
    },
    trustedSignals: {
      default: "downrank",
    },
    allowViewerOverride: false,
  },

  "product-detail": {
    administrativeDeny: {
      visibility: "restrict",
      transaction: "deny",
    },
    trustedSignals: {
      default: "warn",
    },
    allowViewerOverride: true,
  },

  "checkout": {
    administrativeDeny: {
      visibility: "allow",
      transaction: "deny",
    },
    trustedSignals: {
      scam: "require-review",
      malware: "deny",
    },
    allowViewerOverride: false,
  },

  "seller-dashboard": {
    administrativeDeny: {
      visibility: "warn",
      transaction: "deny",
    },
    exposeEvidence: true,
    allowViewerOverride: false,
  },
};
```

A denied product can therefore:

* Disappear from public discovery
* Remain visible to its seller
* Be inspectable in an appeals screen
* Be blocked from checkout

## 12.4 Trusted-mute policy

Trusted mutes must support:

* Ranking effect below threshold
* Configurable validity window
* Category-specific counts
* Category-specific escalation thresholds
* Unique muter counting
* Blocked-reporter exclusion
* Optional decay behavior

The default generic engine should not blur, hide, or deny merely because one trusted account muted another.

## 12.5 Report policy

Applications define category thresholds:

```js
const bitRoadReportPolicy = {
  scam: {
    warn: 2,
    restrict: 3,
    hide: 5,
    transactionDeny: 3,
  },

  malware: {
    warn: 1,
    restrict: 1,
    hide: 2,
    transactionDeny: 1,
  },

  misleading: {
    warn: 3,
    restrict: 5,
    hide: 8,
  },

  spam: {
    downrank: 2,
    hide: 8,
  },
};
```

These are illustrative values, not required defaults.

---

# 13. Runtime Store Architecture

## 13.1 `GovernanceAdminStore`

Responsible for:

* Root state
* Roles
* Capabilities
* User allow contributions
* User deny contributions
* Event deny contributions
* Address deny contributions
* Community sources
* Protected actors
* Effective merged state

## 13.2 `TrustGraphStore`

Responsible for:

* Viewer follows
* Operator trust seeds
* Moderator trust seeds
* Viewer blocks
* Viewer mutes
* Trusted-set calculation
* Trust-set change notifications

## 13.3 `ReportStore`

Responsible for:

* NIP-56 event ingestion
* Target association
* Category normalization
* Unique reporter aggregation
* Trusted/untrusted separation
* Active-target subscriptions
* Report summary snapshots

## 13.4 `TrustedMuteStore`

Responsible for:

* NIP-51 mute lists
* Replaceable-list selection
* Validity windows
* Author aggregation
* Category aggregation
* Batch author queries
* Expired-list pruning

## 13.5 `PolicyStore`

Responsible for:

* Default policy
* Root-published policy
* Local application policy
* Policy-profile selection
* Policy schema validation
* Policy versioning

## 13.6 `OverrideStore`

Responsible for:

* Per-target overrides
* Per-author overrides
* Per-category overrides
* Viewer-scoped persistence
* Override expiry if configured

## 13.7 `GovernanceRuntime`

Responsible for:

* Store lifecycle
* Transport orchestration
* Viewer changes
* Active-target changes
* Evaluation
* Commands
* Subscription fan-out
* Snapshot creation
* Diagnostics

---

# 14. Application Adapter Contract

Each application defines how its objects become governance targets and how decisions map back into application behavior.

```ts
interface GovernanceApplicationAdapter<TObject> {
  applicationId: string;

  toTargets(object: TObject): GovernanceTarget[];

  getPrimaryTargetKey(object: TObject): string;

  applyDecision?(
    object: TObject,
    decision: GovernanceDecision
  ): TObject;
}
```

Some objects should map to multiple targets.

A BitRoad product may be affected by:

* Seller user status
* Exact event status
* Address status

```js
function bitRoadProductTargets(product) {
  return [
    {
      type: "user",
      pubkey: product.pubkey,
    },
    {
      type: "event",
      eventId: product.id,
      author: product.pubkey,
      kind: 30078,
    },
    {
      type: "address",
      coordinate: product.address,
      author: product.pubkey,
      kind: 30078,
    },
  ];
}
```

The runtime or adapter then composes those decisions using an explicit application rule.

---

# 15. BitVid Extraction Map

## 15.1 Move or rewrite into `nostr-governance`

Reusable logic currently found in:

```text
js/services/moderationUtils.js
js/services/moderationService.js
js/accessControl.js
js/adminListStore.js
js/adminListBatch.js
js/adminEventBlacklistHelpers.js
js/services/trustBootstrap.js
admin-related parts of js/nostrEventSchemas.js
```

Extract:

* Identifier normalization
* Report parsing
* Report aggregation
* Trusted-mute aggregation
* Decay-window handling
* Administrative list parsing
* Community source parsing
* Role resolution
* Capability checks
* Protected-actor rules
* Nostr persistence
* Cached fallback
* Active-target subscriptions
* Batched author evidence
* Policy decisions
* Decision explanations

## 15.2 Remain in BitVid

```text
js/app/moderationActionController.js
js/app/moderationCoordinator.js
js/ui/components/VideoCard.js
profile/admin modal controllers
video modal controls
playback coordinators
BitVid CSS and design tokens
feed refresh orchestration
```

`ModerationActionController` remains in BitVid because it currently understands videos, cards, playback resumption, feed refreshes, status messages, and DOM events.

## 15.3 Convert to thin BitVid adapters

### Feed stage

Current:

```text
load evidence
calculate thresholds
apply precedence
calculate hide state
calculate blur state
apply feed bypass
mutate video
```

Target:

```text
collect targets
evaluateMany()
attach decisions
filter items according to feed profile
```

### Moderation decorator

Current:

```text
recalculates moderation policy
```

Target:

```text
maps a GovernanceDecision to video.moderation
```

Example:

```js
function applyGovernanceDecisionToVideo(video, decision) {
  const restricted =
    decision.visibility.effect === "restrict" ||
    decision.visibility.effect === "hide" ||
    decision.visibility.effect === "deny";

  video.moderation = {
    ...video.moderation,

    governanceDecision: decision,

    hidden:
      decision.visibility.effect === "hide" ||
      decision.visibility.effect === "deny",

    blurThumbnail: restricted,

    blockAutoplay:
      decision.interaction.effect !== "allow",

    reasons: decision.reasons,
    evidence: decision.evidence,
  };

  return video;
}
```

### Compatibility facade

Temporarily preserve existing BitVid calls:

```text
isSuperAdmin
isAdminEditor
canEditAdminLists
canAccess
isBlacklisted
isEventBlacklisted
getWhitelist
getBlacklist
getEditors
```

Internally, these become wrappers over the governance runtime.

---

# 16. BitRoad Integration Reference

## 16.1 Why BitRoad is the validation consumer

BitRoad has:

* Sellers
* Storefronts
* Products
* Reviews
* Public marketplace discovery
* Seller dashboards
* Checkout
* Nostr signer abstractions
* Nostr relay abstractions

Its public listing and private purchase architecture is already separated conceptually, and products/storefronts are represented as addressable `kind:30078` events.

Its main application module already consumes separate modules for:

* Product parsing

* Review parsing

* Storefront parsing

* Marketplace filtering and sorting

* Product rendering

* Relay access

* Signer access

This provides natural integration seams.

## 16.2 BitRoad targets

| Object           | Targets                                                    |
| ---------------- | ---------------------------------------------------------- |
| Seller           | User                                                       |
| Storefront       | User + address + exact event                               |
| Product          | Seller user + product address + exact event                |
| Review           | Reviewer user + exact review event                         |
| Store catalog    | Storefront address                                         |
| Imported product | No governance until published, unless local policy applies |

## 16.3 Marketplace pipeline

Current conceptual flow:

```text
relay events
    ↓
parseProductFeed()
    ↓
filterMarketplaceListings()
    ↓
sortMarketplaceListings()
    ↓
renderMarketplaceGrid()
```

Target flow:

```text
relay events
    ↓
parseProductFeed()
    ↓
create governance targets
    ↓
governance.evaluateMany()
    ↓
apply visibility and rank effects
    ↓
filterMarketplaceListings()
    ↓
sortMarketplaceListings()
    ↓
renderMarketplaceGrid()
```

## 16.4 Checkout enforcement

Governance must be evaluated again immediately before checkout.

```js
function assertProductCheckoutAllowed(product) {
  const targets = bitRoadProductTargets(product);

  const decisions = governance.evaluateMany(targets, {
    surface: "checkout",
    policyProfile: "commerce-transaction",
    enforcement: {
      hardHide: true,
      allowOverrides: false,
    },
  });

  const composed = composeBitRoadProductDecision(decisions);

  if (
    composed.transaction?.effect === "deny" ||
    composed.interaction.effect === "deny"
  ) {
    throw new Error("This listing is unavailable for purchase.");
  }

  return composed;
}
```

This prevents a product page opened before a newer governance update from initiating checkout using stale state.

## 16.5 Suggested BitRoad effects

```text
normal
downrank in marketplace
show warning
hide from marketplace
disable checkout
deny seller onboarding
deny new publication
hide storefront
suppress review
```

## 16.6 Suggested BitRoad moderator roles

```js
const bitRoadRoles = {
  listing_moderator: [
    "contribute-event-deny",
    "contribute-address-deny",
    "review-evidence",
  ],

  seller_moderator: [
    "contribute-user-deny",
    "review-evidence",
  ],

  community_curator: [
    "contribute-user-deny",
  ],
};
```

## 16.7 BitRoad proof-of-concept

Before `nostr-governance` reaches `1.0.0`, BitRoad should demonstrate:

1. Seller allowlist mode
2. Administrative seller denial
3. Product-address denial
4. Exact-event denial
5. Trusted scam-report downranking
6. Malware-based checkout denial
7. Moderator capability checks
8. Community curator ingestion
9. Seller-dashboard explanation
10. No changes to the generic core

The purpose is not to ship all BitRoad moderation immediately. It is to prove the extracted API does not accidentally remain video-specific.

---

# 17. Migration Plan

## Phase 0 — Characterize current BitVid behavior

### Work

* Pin the BitVid baseline commit.
* Reconcile documentation with current code.
* Inventory list identifiers.
* Inventory storage keys.
* Inventory event kinds.
* Inventory public service methods.
* Document decision precedence.
* Document feed exceptions.
* Document overrides.
* Record relay-request and feed-evaluation performance.
* Add missing characterization tests.
* Resolve delegated-authority behavior.

### Required tests

* Trusted report threshold
* Duplicate reporter
* Blocked reporter
* Trusted mute below threshold
* Trusted mute at threshold
* Expired trusted mute
* Personal block precedence
* Administrative blacklist
* Event blacklist
* Community blacklist
* Moderator trust seed
* Viewer override
* Author override
* Home/Recent hide bypass
* Cache fallback

### Acceptance

* The current behavior is reproducible from fixtures.
* Intentional policy changes cause test failures.
* Tests read defaults from configuration instead of duplicating values.

---

## Phase 1 — Create the repository

### Work

* Create npm workspace.
* Configure Node.js 22.
* Configure ESM.
* Add linting.
* Add test runner.
* Add JSDoc type checking.
* Generate type declarations.
* Add changelog.
* Add architecture-decision records.
* Add GPL-compatible license.

BitVid currently declares GPL-3.0-or-later, so directly extracted code should retain compatible licensing unless an independently implemented clean rewrite is performed.

### Acceptance

* Packages build independently.
* Core imports no browser globals.
* CI runs unit and contract tests.
* Empty runtime initializes with fake dependencies.

---

## Phase 2 — Implement the pure core

### Work

Implement:

* Target normalization
* Strict pubkey normalization
* Strict event-ID normalization
* Address parsing
* Role resolution
* Capability resolution
* Administrative-state reduction
* Policy schema
* Policy normalization
* Pure evaluator
* Decision composition
* Explanation traces
* Snapshot fingerprints

### Acceptance

* Identical snapshots produce identical decisions.
* Evaluation performs no I/O.
* Evaluation mutates no input.
* Core can run in Node without browser polyfills.
* Core contains no BitVid or BitRoad terms.

---

## Phase 3 — Implement codecs

### Work

Implement:

* Canonical v1 codec
* BitVid legacy admin codec
* Existing BitVid event-blacklist codec
* Existing BitVid community-source codec
* NIP-56 codec
* NIP-51 codec
* Replaceable-event selection
* Signature-verification hooks

### Acceptance

* Existing BitVid fixtures parse correctly.
* Malformed tags are ignored safely.
* Npub and hex inputs normalize consistently.
* Latest-event selection matches current BitVid behavior.
* Same-timestamp ties are deterministic.
* Legacy state can be represented as a normalized snapshot.

---

## Phase 4 — Implement runtime stores

### Work

Build:

* `GovernanceAdminStore`
* `TrustGraphStore`
* `ReportStore`
* `TrustedMuteStore`
* `PolicyStore`
* `OverrideStore`
* `GovernanceRuntime`

### Acceptance

* Stores use injected transport.
* Stores use injected storage.
* Stores emit only on actual changes.
* Viewer switching clears viewer-specific state.
* Subscriptions close on destroy.
* Report subscriptions remain batched.
* Author evidence can be queried in batches.
* Expired trusted mutes are pruned with an injected clock.

---

## Phase 5 — Implement public commands

### Work

Implement:

* Role commands
* Capability commands
* User list commands
* Event list commands
* Address list commands
* Community source commands
* Policy commands
* Report publishing
* Partial relay acceptance
* Stable error codes

### Acceptance

* Every command checks authority.
* Unauthorized actors cannot sign an accepted mutation.
* Revoked actors’ contributions stop affecting effective state.
* Protected actors cannot be denied.
* First relay acceptance may complete the command.
* Remaining relay results remain observable for diagnostics.

---

## Phase 6 — Add BitVid compatibility layer

### Work

Build facades matching current BitVid service methods.

Add:

```text
FEATURE_EXTERNAL_GOVERNANCE_SHADOW
```

For each BitVid target:

1. Evaluate with current BitVid implementation.
2. Evaluate with external runtime.
3. Normalize both outputs.
4. Log differences in development.
5. Continue rendering from current BitVid output.

### Mismatch record

```js
{
  targetKey,
  author,
  currentDecision,
  externalDecision,
  policyFingerprint,
  trustFingerprint,
  adminFingerprint,
}
```

### Acceptance

* No production-visible changes.
* Characterization fixtures show zero unexplained mismatches.
* Live-feed sampling reveals no systematic mismatch.
* Shadow mode does not materially regress feed performance.

---

## Phase 7 — Cut over BitVid administrative state

### Work

Replace:

* Admin-list loading
* Admin-list caching
* Community-source merging
* Role checks
* User allow/deny state
* Event deny state

Keep the old BitVid public facade temporarily.

### Acceptance

* Existing lists remain effective.
* Cached fallback remains effective.
* Community-curated lists remain effective.
* Administrator protection remains effective.
* Moderators have cryptographically defined authority.
* Existing admin UI continues working.

---

## Phase 8 — Cut over BitVid reports and trust

### Work

Replace:

* Trusted-contact state
* Trust-seed state
* Report aggregation
* Trusted-mute aggregation
* Decay handling
* Active-target subscriptions
* Author evidence batching

### Acceptance

* Trusted mutes remain ranking-only below threshold.
* Current report thresholds remain unchanged.
* Current hide thresholds remain unchanged.
* Blocked reporters remain excluded.
* Anonymous trust seeds remain functional.
* Moderator changes update trust seeds.
* No relay-request regression occurs.

---

## Phase 9 — Cut over BitVid policy

### Work

* Make `evaluateMany()` authoritative.
* Reduce the feed stage to target collection and decision application.
* Reduce `ModerationDecorator` to presentation mapping.
* Preserve BitVid policy profiles for Home, Recent, Discovery, and playback.
* Preserve existing overrides.
* Preserve UI behavior.

Add:

```text
FEATURE_EXTERNAL_GOVERNANCE
```

Keep old policy behind a rollback flag for one stabilization cycle.

### Acceptance

* One canonical evaluator remains.
* Existing unit tests pass.
* Existing visual moderation tests pass.
* Override restoration works.
* Home and Recent behavior remains correct.
* Playback behavior remains correct.
* The old evaluator can be disabled without UI changes.

---

## Phase 10 — Validate through BitRoad

### Work

Implement inside BitRoad:

```text
src/governance/runtime.mjs
src/governance/transportAdapter.mjs
src/governance/signerAdapter.mjs
src/governance/productAdapter.mjs
src/governance/storefrontAdapter.mjs
src/governance/reviewAdapter.mjs
src/governance/policy.mjs
```

Integrate into:

* Marketplace loading
* Product detail
* Storefront catalogs
* Reviews
* Checkout
* Seller dashboard

### Acceptance

* Product-address denial persists across revisions.
* Seller denial affects all seller products.
* Exact-event denial affects only the selected event.
* Trusted reports can downrank marketplace items.
* Checkout performs a fresh governance check.
* Seller dashboard can explain restrictions.
* No core package changes are required for BitRoad.

---

## Phase 11 — Remove duplicated BitVid logic

### Work

Delete:

* Duplicate threshold calculation
* Duplicate target normalization
* Duplicate list parsing
* Duplicate report aggregation
* Duplicate trusted-mute aggregation
* Duplicate authority checks
* Direct relay access from removed services

Retain:

* BitVid policy configuration
* BitVid adapter
* BitVid UI
* BitVid action controller
* BitVid orchestration

### Acceptance

* Removing old services does not change behavior.
* BitVid imports only documented public package APIs.
* No consumer imports package-internal paths.

---

# 18. Testing Strategy

## 18.1 Core policy tests

Cover:

* Personal block precedence
* Personal mute
* User denial
* Event denial
* Address denial
* Allowlist miss
* Trusted mute below threshold
* Trusted mute at threshold
* Trusted reports by category
* Viewer override
* Policy profile differences
* Protected target
* Transaction denial
* Deterministic explanation trace

## 18.2 Authority tests

Cover:

* Root grants role
* Root revokes role
* Moderator cannot manage roles
* Curator can contribute only allowed lists
* Removed moderator contribution is ignored
* Unknown capability is ignored
* Actor cannot self-escalate
* Protected root cannot be denied
* Invalid root signature is rejected

## 18.3 Trust tests

Cover:

* F1 reports count
* Non-F1 reports do not count
* Trust seeds count
* Duplicate reports count once
* Blocked reporters do not count
* Muted reporters do not count
* Trust changes recompute summaries
* Anonymous and authenticated trust differ correctly

## 18.4 Trusted-mute tests

Cover:

* Rolling validity window
* Expired lists
* New list replacement
* Category metadata
* Total counts
* Category counts
* Batch author lookup
* Ranking-only behavior below threshold
* Hide behavior at threshold

## 18.5 Transport tests

Cover:

* Relay timeout
* Partial acceptance
* No relay acceptance
* Out-of-order events
* Duplicate events
* Same-timestamp replacement
* Subscription closure
* Active-target changes
* Large filter chunking
* Reconnection
* Cached fallback

## 18.6 Storage contract tests

Every storage adapter must pass one shared suite:

* Missing key
* Read/write
* Remove
* Invalid data
* Version migration
* Viewer separation
* Root-authority separation
* Schema-version separation

## 18.7 BitVid integration tests

Retain and expand:

* Trusted-report tests
* Trusted-mute tests
* Admin-list-store tests
* Trust-seed tests
* Moderation-stage tests
* Moderation-decorator tests
* Override tests
* Visual moderation tests
* Admin UI tests

BitVid’s existing QA plan already identifies the principal trusted-report, hide, override, muted-reporter, and visual scenarios that should seed the package conformance suite.

## 18.8 BitRoad integration tests

Cover:

* Denied seller removed from marketplace
* Denied seller still sees dashboard explanation
* Product address denial survives replacement
* Exact event denial does not deny a different address revision unless policy composes it
* Checkout denial occurs before invoice creation
* Marketplace downranking preserves stable sorting
* Review-author denial suppresses reviews
* Anonymous marketplace uses trust seeds
* Signed-in buyer uses personal trust graph
* Viewer state does not leak between accounts

---

# 19. Security Requirements

The repository must:

1. Verify signatures before accepting authoritative state.
2. Validate authority independently of UI state.
3. Use strict 64-character pubkey and event-ID validation.
4. Validate address coordinates.
5. Bound list sizes.
6. Bound reference counts.
7. Bound policy content size.
8. Ignore unknown capabilities.
9. Ignore unauthorized contributor events.
10. Protect root and configured system accounts.
11. Deduplicate reports by reporter, target, and category.
12. Apply configurable mute-list expiry.
13. Namespace caches correctly.
14. Prevent viewer-state leakage.
15. Never export signer secrets.
16. Avoid shared moderator keys.
17. Treat relays as transport rather than authority.
18. Preserve the last-known valid state during transient relay failure.
19. Mark stale state in diagnostics.
20. Fail closed for administrative commands when authority cannot be confirmed.
21. Permit policy-configured fail-open behavior for public viewing where appropriate.

---

# 20. Performance Requirements

## 20.1 Required characteristics

* No subscription per card
* No async evaluation per item
* One logical subscription per active signal class
* Bounded `#e` and `#a` filter chunks
* Batched author evidence lookup
* Decision caching by target and state fingerprint
* Incremental invalidation
* Emit only on actual state changes
* Cancel obsolete active-target work
* Close subscriptions on view changes
* No repeated full-list parsing during individual evaluations

## 20.2 Performance fixture

Include:

```text
5,000 targets
500 authors
100 trusted muters per author
multiple report categories
multiple administrative contributors
multiple policy profiles
viewer switching
moderator roster changes
relay reconnect
```

## 20.3 Performance acceptance

* `evaluateMany(5,000)` performs no network access.
* Batch evaluation does not regress below the current BitVid baseline.
* Updating one report invalidates only affected target decisions.
* Updating one author mute state invalidates only that author’s targets.
* Changing policy may intentionally invalidate all decisions.
* Destroy leaves no active timers or subscriptions.

---

# 21. Optional HTTP and Cloudflare Adapter

The headless SDK does not require a server.

A later package may provide:

```text
@nostr-governance/http
@nostr-governance/cloudflare-worker
```

Suggested routes:

```text
POST /v1/evaluate
POST /v1/evaluate-many

GET  /v1/users/:pubkey/status
POST /v1/targets/status

GET  /v1/policy
GET  /v1/roles

POST /v1/commands/user-deny
POST /v1/commands/event-deny
POST /v1/commands/address-deny

POST /v1/reports
```

Rules:

* The HTTP adapter must call the SDK.
* It must not contain a second evaluator.
* Administrative requests require cryptographic authentication.
* Public evaluation responses must avoid leaking sensitive trust-graph details.
* BitVid and BitRoad must remain capable of using the SDK directly.

---

# 22. Versioning and Releases

## 22.1 Proposed releases

```text
0.1.x
Core targets, authority, policy, evaluator, fixtures

0.2.x
Nostr codecs and storage contracts

0.3.x
Runtime stores, subscriptions, commands

0.4.x
BitVid compatibility and shadow mode

0.5.x
BitVid administrative cutover

0.6.x
BitVid trust and policy cutover

0.7.x
BitRoad proof-of-concept

0.8–0.9.x
API stabilization, security audit, documentation

1.0.0
Stable SDK and canonical schema v1
```

## 22.2 Versioning rules

* Use semantic versioning.
* Version event schemas separately.
* Do not remove legacy codecs in a minor release.
* Document policy-output changes prominently.
* Include decision fixtures in breaking-change reviews.
* Pin exact package versions during pre-1.0 BitVid migration.
* Add automated dependency updates after API stabilization.

## 22.3 Consumer contract tests

The governance repository should expose:

```text
npm run test:consumer:bitvid
npm run test:consumer:bitroad
```

Each consumer should run governance conformance fixtures before dependency updates are merged.

---

# 23. Risks and Mitigations

## Risk: Extracting BitVid assumptions into the core

**Mitigation:** Require BitRoad proof-of-concept before `1.0.0`.

## Risk: Policy logic remains duplicated in BitVid

**Mitigation:** Enforce one evaluator and prohibit adapters from calculating thresholds.

## Risk: Delegated moderation is only a UI permission

**Mitigation:** Root-authorized contributor model with signature and capability verification.

## Risk: Product bans are bypassed through replacement events

**Mitigation:** First-class address targets.

## Risk: Relay outages erase administrative state

**Mitigation:** Last-known valid cached snapshots with stale-state diagnostics.

## Risk: Community curators gain excess authority

**Mitigation:** Curator-specific capabilities and list-type validation.

## Risk: Viewer overrides bypass transactional safety

**Mitigation:** Policy profiles independently control visibility, interaction, and transaction effects.

## Risk: Extraction causes feed-performance regression

**Mitigation:** Preserve active-target batching, author batching, and benchmark gates.

## Risk: Legacy BitVid state is lost

**Mitigation:** Compatibility codec, read-both migration, optional dual-write.

## Risk: Package and event-schema upgrades become coupled

**Mitigation:** Independent schema, policy, and package versions.

---

# 24. Definition of Done

The project is complete when:

* BitVid imports the external governance runtime.
* BitVid’s existing administrative lists still work.
* BitVid’s community curators still work.
* BitVid’s trust seeds still work.
* BitVid’s reports and trusted mutes retain current behavior.
* Trusted mutes remain ranking-only below threshold.
* BitVid policy is calculated in one place.
* BitVid UI remains owned by BitVid.
* BitRoad can consume the same runtime without core modifications.
* BitRoad can govern sellers, exact product events, and product addresses.
* BitRoad checks governance before checkout.
* Delegated authority is cryptographically verifiable.
* Core packages contain no video, card, modal, marketplace, or checkout UI concepts.
* No package consumer imports internal source paths.
* Transport, signer, and storage are injected.
* Unit, integration, visual, security, and performance tests pass.
* Shadow mode produces no unexplained BitVid differences.
* The original duplicate BitVid governance code can be removed.
* Canonical schema v1 is documented.
* Public SDK methods are documented.
* Consumer integration examples are functional.

---

# 25. Recommended PR Sequence

## Repository PRs

1. Create workspace and CI.
2. Add identifiers and target model.
3. Port BitVid fixtures into conformance tests.
4. Implement authority and capability resolution.
5. Implement policy schema and pure evaluator.
6. Implement canonical v1 codec.
7. Implement BitVid legacy codecs.
8. Add fake transport, signer, storage, and clock.
9. Implement administrative store.
10. Implement trust graph.
11. Implement report store.
12. Implement trusted-mute store.
13. Implement runtime lifecycle.
14. Implement commands.
15. Implement public diagnostics.
16. Publish `0.3.0`.

## BitVid PRs

17. Add package and compatibility facade.
18. Add shadow evaluation.
19. Resolve decision mismatches.
20. Cut over administrative state.
21. Cut over trust and reports.
22. Cut over policy evaluation.
23. Remove duplicate policy from decorator.
24. Remove legacy internal services.
25. Enable external governance by default.

## BitRoad PRs

26. Add governance transport and signer adapters.
27. Add seller, product, storefront, and review target adapters.
28. Add marketplace evaluation.
29. Add product-detail warnings.
30. Add checkout enforcement.
31. Add administrator capability checks.
32. Add seller-dashboard explanations.
33. Add BitRoad consumer contract tests.

## Stabilization PRs

34. Security review.
35. Performance review.
36. Event-schema documentation.
37. Migration documentation.
38. Public API freeze.
39. Publish `1.0.0`.

---

# 26. First Build Milestone

The first meaningful milestone should not be a UI or a complete runtime.

Build this vertical slice:

```text
BitVid fixture events
        ↓
BitVid legacy codec
        ↓
normalized governance snapshot
        ↓
pure evaluator
        ↓
generic GovernanceDecision
        ↓
BitVid decision adapter
```

The milestone is successful when the package can take existing BitVid moderation fixtures and produce decisions equivalent to the current implementation without importing BitVid application code.

That establishes the durable core around which transport, storage, commands, shadow mode, and BitRoad integration can be built.
