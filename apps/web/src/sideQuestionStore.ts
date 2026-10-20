import type { ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

/**
 * Which side question a thread's card shows, whether it is folded, and whether
 * the card is dismissed. The questions themselves are threads on the server;
 * this is only the view, so dismissing never loses a question.
 */
export interface SideQuestionViewState {
  readonly viewingThreadId: ThreadId | null;
  readonly collapsed: boolean;
  readonly hidden: boolean;
}

interface SideQuestionStoreState {
  readonly byParentKey: Readonly<Record<string, SideQuestionViewState>>;
  readonly show: (parentKey: string, threadId: ThreadId) => void;
  readonly setCollapsed: (parentKey: string, collapsed: boolean) => void;
  readonly clearViewing: (parentKey: string) => void;
  readonly hide: (parentKey: string) => void;
}

const DEFAULT_VIEW: SideQuestionViewState = {
  viewingThreadId: null,
  collapsed: false,
  hidden: false,
};

export const useSideQuestionStore = create<SideQuestionStoreState>()(
  persist(
    (set) => ({
      byParentKey: {},
      show: (parentKey, threadId) =>
        set((state) => ({
          byParentKey: {
            ...state.byParentKey,
            [parentKey]: { viewingThreadId: threadId, collapsed: false, hidden: false },
          },
        })),
      setCollapsed: (parentKey, collapsed) =>
        set((state) => ({
          byParentKey: {
            ...state.byParentKey,
            [parentKey]: { ...(state.byParentKey[parentKey] ?? DEFAULT_VIEW), collapsed },
          },
        })),
      clearViewing: (parentKey) =>
        set((state) => {
          const current = state.byParentKey[parentKey];
          if (current === undefined) return state;
          return {
            byParentKey: {
              ...state.byParentKey,
              [parentKey]: { ...current, viewingThreadId: null },
            },
          };
        }),
      hide: (parentKey) =>
        set((state) => ({
          byParentKey: {
            ...state.byParentKey,
            [parentKey]: { ...(state.byParentKey[parentKey] ?? DEFAULT_VIEW), hidden: true },
          },
        })),
    }),
    {
      name: "t3code:side-questions",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window === "undefined" ? null : window.localStorage),
      ),
      partialize: (state) => ({ byParentKey: state.byParentKey }),
    },
  ),
);

export function selectSideQuestionView(
  state: SideQuestionStoreState,
  parentKey: string | null,
): SideQuestionViewState {
  return parentKey === null ? DEFAULT_VIEW : (state.byParentKey[parentKey] ?? DEFAULT_VIEW);
}
