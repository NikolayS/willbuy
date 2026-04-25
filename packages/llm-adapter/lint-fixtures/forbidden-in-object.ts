// Lint fixture: forbidden identifier as a property of an object literal —
// the canonical "LLM call site argument" shape. Spec §2 #15 forbids carrying
// state across calls; this would do exactly that.

export const payload = {
  thread_id: 'leak',
};
