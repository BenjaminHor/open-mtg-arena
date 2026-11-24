import { create } from "zustand";

/**
 * Why boot left audio switched off. The store carries the reason rather than a
 * bare "blocked" flag so the UI picks its message from the reason.
 *
 * - `media-unavailable`: the device opened, but the browser's media pipeline
 *   never finished decoding a sound within the boot deadline.
 */
export type AudioUnavailableReason = "media-unavailable";

interface AudioHealthState {
  /** `null` while audio is healthy. */
  unavailable: AudioUnavailableReason | null;
  setUnavailable: (unavailable: AudioUnavailableReason | null) => void;
}

export const useAudioHealthStore = create<AudioHealthState>((set) => ({
  unavailable: null,
  setUnavailable: (unavailable) => set({ unavailable }),
}));
