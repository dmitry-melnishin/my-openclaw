/**
 * Sessions layer — public API.
 *
 * @example
 * ```ts
 * import {
 *   buildSessionKey,
 *   appendMessage,
 *   loadTranscript,
 *   updateSessionMeta,
 * } from "./sessions/index.js";
 *
 * const key = buildSessionKey({
 *   channel: "telegram",
 *   peerKind: "direct",
 *   peerId: "user_123",
 * });
 *
 * appendMessage(key, { role: "user", content: "Hello" });
 * const history = loadTranscript(key);
 * updateSessionMeta(key, { lastChannel: "telegram" });
 * ```
 */

export {
  buildSessionKey,
  parseSessionKey,
  sessionKeyToSlug,
  type SessionKeyParams,
  type ParsedSessionKey,
  type PeerKind,
} from "./session-key.js";

export {
  appendMessage,
  appendMessages,
  loadTranscript,
  countMessages,
  deleteTranscript,
  resolveTranscriptPath,
  type TranscriptMessage,
  type MessageRole,
} from "./transcript.js";

export {
  loadSessionStore,
  saveSessionStore,
  updateSessionStore,
  getSessionEntry,
  updateSessionMeta,
  deleteSessionEntry,
  listSessionKeys,
  pruneSessions,
  clearStoreCache,
  resolveStorePath,
  type SessionEntry,
  type SessionStore,
} from "./store.js";
