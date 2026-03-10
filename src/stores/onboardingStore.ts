import { create } from "zustand";

interface OnboardingState {
  currentStep: number;
  selectedModel: string;
  selectedModelId: string;
  apiKey: string;
  selectedChannels: string[];
  selectedScenario: string;
  selectedToolsProfile: string;
  setStep: (step: number) => void;
  setModel: (model: string) => void;
  setModelId: (id: string) => void;
  setApiKey: (key: string) => void;
  toggleChannel: (id: string) => void;
  setChannels: (ids: string[]) => void;
  setScenario: (id: string) => void;
  setToolsProfile: (profile: string) => void;
  hydrate: (data: Partial<Pick<OnboardingState, "selectedModel" | "selectedModelId" | "selectedChannels" | "selectedScenario" | "selectedToolsProfile">>) => void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  currentStep: 1,
  selectedModel: "openai",
  selectedModelId: "",
  apiKey: "",
  selectedChannels: [],
  selectedScenario: "default",
  selectedToolsProfile: "messaging",
  setStep: (step) => set({ currentStep: step }),
  setModel: (model) => set({ selectedModel: model, selectedModelId: "" }),
  setModelId: (id) => set({ selectedModelId: id }),
  setApiKey: (key) => set({ apiKey: key }),
  toggleChannel: (id) =>
    set((state) => ({
      selectedChannels: state.selectedChannels.includes(id)
        ? state.selectedChannels.filter((c) => c !== id)
        : [...state.selectedChannels, id],
    })),
  setChannels: (ids) => set({ selectedChannels: ids }),
  setScenario: (id) => set({ selectedScenario: id }),
  setToolsProfile: (profile) => set({ selectedToolsProfile: profile }),
  hydrate: (data) => set((state) => ({ ...state, ...data })),
}));
