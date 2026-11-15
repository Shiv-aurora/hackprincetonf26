"use client";
// Full-screen stage for the film steps, under the caption pill and above the controls. The CSS-3D film is the
// default; `?film=3d` in the URL swaps in the WebGL film (three.js, loaded only then). The tour keeps other
// query params when it changes step, so the choice holds for the whole demo. No WebGL → the CSS film.

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { Film, type Shot } from "./Film";

const Film3D = dynamic(() => import("./Film3D").then((m) => m.Film3D), { ssr: false });

let webgl: boolean | null = null;
function hasWebGL(): boolean {
  if (webgl === null) {
    try {
      const c = document.createElement("canvas");
      webgl = !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      webgl = false;
    }
  }
  return webgl;
}

const noop = () => () => {};
function useFilmMode(): "css" | "3d" {
  return useSyncExternalStore(
    noop,
    () => (new URLSearchParams(window.location.search).get("film") === "3d" && hasWebGL() ? "3d" : "css"),
    () => "css",
  );
}

export function FilmLayer({ shot }: { shot: Shot }) {
  const mode = useFilmMode();
  return (
    <div className="fixed inset-0 z-50 bg-background pt-[108px] pb-[64px]">
      {mode === "3d" ? <Film3D shot={shot} className="h-full w-full" /> : <Film shot={shot} className="h-full w-full" />}
    </div>
  );
}
