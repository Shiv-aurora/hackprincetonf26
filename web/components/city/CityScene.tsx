"use client";
// Public entry: <CityScene />. Loads the WebGL canvas client-only so SSR never touches three.
import dynamic from "next/dynamic";

const CityCanvas = dynamic(() => import("./CityCanvas"), {
  ssr: false,
  loading: () => null,
});

export interface CitySceneProps {
  className?: string;
  /** "live" (default): reacts to hub events, HUD labels, cinematic drift + fly-to.
   *  "landing": slow orbit, decorative ambient traffic, no HUD. */
  mode?: "live" | "landing";
  /** Hospital id to hold the camera on (e.g. from a timeline chip click). null/undefined = auto. */
  focusHospital?: string | null;
  /** Show the HTML labels over towers. Defaults to true in live mode, false in landing mode. */
  hud?: boolean;
}

export function CityScene({ className, mode = "live", focusHospital = null, hud }: CitySceneProps) {
  return (
    <div
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", background: "#05070d", overflow: "hidden" }}
    >
      <style>{`@keyframes mjcity-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(1.6)}}`}</style>
      <CityCanvas mode={mode} focusHospital={focusHospital} hud={hud ?? mode === "live"} />
    </div>
  );
}

export default CityScene;
