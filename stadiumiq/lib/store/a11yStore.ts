import { create } from "zustand";

interface A11yState {
  highContrast: boolean;
  fontScale: 1 | 1.15 | 1.3;
  ttsEnabled: boolean;
  toggleHighContrast: () => void;
  setFontScale: (scale: 1 | 1.15 | 1.3) => void;
  toggleTts: () => void;
}

// Pure state container. DOM side effects (applying the `high-contrast` class and
// the `--font-scale` custom property) are handled declaratively in A11yControls
// via effects, keeping the store free of side effects.
export const useA11yStore = create<A11yState>((set) => ({
  highContrast: false,
  fontScale: 1,
  ttsEnabled: false,
  toggleHighContrast: () => set((state) => ({ highContrast: !state.highContrast })),
  setFontScale: (scale) => set({ fontScale: scale }),
  toggleTts: () => set((state) => ({ ttsEnabled: !state.ttsEnabled })),
}));
