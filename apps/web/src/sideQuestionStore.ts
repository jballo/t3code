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
  /**
   * The viewed question was just asked, so its thread may not have synced yet.
   * Until it does, its absence means "on its way", not "deleted". Not saved: a
   * reload drops the request that would clear it if the ask failed.
   */
  readonly justAsked?: boolean;
  readonly collapsed: boolean;
  readonly hidden: boolean;
}

interface SideQuestionStoreState {
  readonly byParentKey: Readonly<Record<string, SideQuestionViewState>>;
  readonly show: (parentKey: string, threadId: ThreadId) => void;
  readonly showAsked: (parentKey: string, threadId: ThreadId) => void;
  readonly settleAsked: (parentKey: string) => void;
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
      showAsked: (parentKey, threadId) =>
        set((state) => ({
          byParentKey: {
            ...state.byParentKey,
            [parentKey]: {
              viewingThreadId: threadId,
              justAsked: true,
              collapsed: false,
              hidden: false,
            },
          },
        })),
      settleAsked: (parentKey) =>
        set((state) => {
          const current = state.byParentKey[parentKey];
          if (current?.justAsked !== true) return state;
          return {
            byParentKey: { ...state.byParentKey, [parentKey]: { ...current, justAsked: false } },
          };
        }),
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
              [parentKey]: { ...current, viewingThreadId: null, justAsked: false },
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
      partialize: (state) => ({
        byParentKey: Object.fromEntries(
          Object.entries(state.byParentKey).map(([key, view]) => [
            key,
            {
              viewingThreadId: view.viewingThreadId,
              collapsed: view.collapsed,
              hidden: view.hidden,
            },
          ]),
        ),
      }),
    },
  ),
);

export function selectSideQuestionView(
  state: SideQuestionStoreState,
  parentKey: string | null,
): SideQuestionViewState {
  return parentKey === null ? DEFAULT_VIEW : (state.byParentKey[parentKey] ?? DEFAULT_VIEW);
}
