import { create } from "zustand";

interface RoleState {
  role: "fan" | "organizer";
  setRole: (role: "fan" | "organizer") => void;
  toggleRole: () => void;
}

export const useRoleStore = create<RoleState>((set) => ({
  role: "fan",
  setRole: (role) => set({ role }),
  toggleRole: () => set((state) => ({ role: state.role === "fan" ? "organizer" : "fan" })),
}));
