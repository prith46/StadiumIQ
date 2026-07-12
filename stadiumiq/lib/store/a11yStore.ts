import { create } from "zustand";

interface A11yState {
  fontScale: 1 | 1.15 | 1.3;
  ttsEnabled: boolean;
  setFontScale: (scale: 1 | 1.15 | 1.3) => void;
  toggleTts: () => void;
}

// Pure state container. DOM side effects (applying the `--font-scale` custom
// property) are handled declaratively in A11yControls via effects, keeping
// the store free of side effects.
export const useA11yStore = create<A11yState>((set) => ({
  fontScale: 1,
  ttsEnabled: false,
  setFontScale: (scale) => set({ fontScale: scale }),
  toggleTts: () => set((state) => ({ ttsEnabled: !state.ttsEnabled })),
}));
