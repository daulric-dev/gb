"use client";

import { createContext, useContext } from "react";
import type { ParentChild } from "@/lib/parent";

export interface ParentState {
  children: ParentChild[];
  /** The child the current page is about (or the first), null with none. */
  selected: ParentChild | null;
  reload: () => void;
}

export const ParentContext = createContext<ParentState>({
  children: [],
  selected: null,
  reload: () => undefined,
});

export function useParentChildren(): ParentState {
  return useContext(ParentContext);
}
