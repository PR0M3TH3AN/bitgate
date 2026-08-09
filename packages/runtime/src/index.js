// @bitgate/runtime
//
// Stateful orchestration: stores, transport wiring, viewer lifecycle,
// evaluation, and commands. Transport, signer, and storage are injected, so the
// package depends on no particular relay pool or key manager.

export { Emitter } from "./emitter.js";

export { createRelayTransport } from "./relayTransport.js";

export {
  storageKey,
  createMemoryStorage,
  createMemoryTransport,
  createNullSigner,
} from "./interfaces.js";

export {
  GovernanceAdminStore,
  TrustGraphStore,
  ReportStore,
  TrustedMuteStore,
  PolicyStore,
  OverrideStore,
} from "./stores.js";

export {
  DEFAULT_CHUNK_SIZE,
  GovernanceRuntime,
  chunk,
  createBitGate,
} from "./runtime.js";

export { ERROR_CODES, GovernanceCommands, createCommands } from "./commands.js";

/**
 * @typedef {import('./interfaces.js').GovernanceTransport} GovernanceTransport
 * @typedef {import('./interfaces.js').GovernanceSigner} GovernanceSigner
 * @typedef {import('./interfaces.js').GovernanceStorage} GovernanceStorage
 * @typedef {import('./interfaces.js').PublishResult} PublishResult
 * @typedef {import('./commands.js').CommandResult} CommandResult
 */
