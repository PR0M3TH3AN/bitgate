# Interoperable moderation with NIP-32

BitGate reads and writes NIP-32 labels (kind 1985), so a deployment's
moderators can be honoured by other Nostr clients, and BitGate can act on
labels published by others.

## The model

A label is `(namespace, value, target)`. It carries no built-in meaning — a
`"deny"` label and an `"nsfw"` label are the same kind of object. What a label
means to *your* application is a policy decision you supply:

```js
createBitGate({
  namespace: "myapp",
  labelMapping: {
    namespace: "com.myapp.moderation",   // only labels in this namespace map
    denyValues: ["deny", "spam", "scam"], // your vocabulary for "hide this"
    allowValues: ["trusted"],
  },
  …
});
```

A label matching that mapping becomes a **contribution**, authored by the
labeller. It denies someone only if the labeller holds the capability in your
roster — exactly like a community source. An untrusted labeller's `deny` does
nothing.

## Consuming a third-party labeller

Add the labeller to the roster with a contribution capability, then fetch their
labels:

```js
runtime.admin.setRoles({
  root: ROOT,
  roles: { external_labeller: ["contribute-user-deny", "contribute-event-deny"] },
  actors: { [ROOT]: ["super_admin"], [LABELLER_PUBKEY]: ["external_labeller"] },
});

await runtime.loadLabels([LABELLER_PUBKEY]);
```

## Publishing labels

A moderator publishes a label with the same capability that lets them deny
directly:

```js
await commands.publishLabel({ type: "user", pubkey }, "deny");
await commands.publishLabel({ type: "event", id }, "nsfw", { content: "graphic" });
```

Other clients that understand your namespace can then act on it.

## Generic use

The codec is not BitGate-specific. `decodeLabels(event)` returns every label
(namespace, value, targets) regardless of vocabulary, so an application can
consume topic or licence labels directly without going through the allow/deny
mapping.
