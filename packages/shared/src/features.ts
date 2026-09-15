/** Product switches shared by the API and the clients. */
export const FEATURES = {
  /** Per-call message threads. Turned off for now: routes answer 404 and the UI hides the thread. */
  messages: false,
} as const;
