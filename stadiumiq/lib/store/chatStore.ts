import { create } from 'zustand';
import { Message } from '../../components/assistant/MessageBubble';

interface ChatStore {
  messages: Message[];
  setMessages: (updater: Message[] | ((prev: Message[]) => Message[])) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  setMessages: (updater) => set((state) => ({
    messages: typeof updater === 'function' ? updater(state.messages) : updater
  })),
  clearMessages: () => set({ messages: [] })
}));
