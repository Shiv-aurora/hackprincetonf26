// Public API of the MayaJaal soundscape.
//
//   import { Soundscape, SoundToggle } from "@/lib/sound";
//   <Soundscape />            // once per page: maps hub events → sound (needs connectHub() somewhere)
//   <SoundToggle fixed />     // top-right mute button + hover master volume
//
//   soundEngine.reveal()      // fire a cue by hand (e.g. a manual Reveal button)

export { soundEngine } from "./engine";
export type { TickTier, TickActor } from "./engine";
export {
  useSound, enableSound, disableSound, toggleSound, setMasterVolume, hydrateSound,
} from "./store";
export { useSoundscape, Soundscape, topThreat, SOUND_TOGGLE_ATTR } from "./useSoundscape";
export type { SoundscapeOptions } from "./useSoundscape";
export { SoundToggle } from "./SoundToggle";
export type { SoundToggleProps } from "./SoundToggle";
