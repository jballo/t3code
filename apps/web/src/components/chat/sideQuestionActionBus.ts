const SIDE_QUESTION_PREFILL_EVENT = "t3:side-question-prefill";

/** The palette and the keybinding both put `/btw ` in the composer; ChatView owns the composer. */
export function requestSideQuestionPrefill(): void {
  window.dispatchEvent(new Event(SIDE_QUESTION_PREFILL_EVENT));
}

export function subscribeSideQuestionPrefill(listener: () => void): () => void {
  window.addEventListener(SIDE_QUESTION_PREFILL_EVENT, listener);
  return () => window.removeEventListener(SIDE_QUESTION_PREFILL_EVENT, listener);
}
