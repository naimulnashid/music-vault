import { Easing } from "remotion";

/** One logged pointer or key event from apps/web/scripts/demo-video.mjs. x and y are 0..1 of the viewport. */
export type CaptureEvent =
  | { t: number; type: "move"; x: number; y: number; ms: number }
  | { t: number; type: "click" | "dblclick" | "down" | "up"; x: number; y: number }
  | { t: number; type: "type"; text: string }
  | { t: number; type: "key"; key: string }
  | { t: number; type: "scroll"; dy: number; ms: number }
  // From apps/android/scripts/demo-video.mjs: touches on the phone.
  | { t: number; type: "tap"; x: number; y: number }
  | { t: number; type: "swipe"; x: number; y: number; to: { x: number; y: number }; ms: number };

export interface CaptureShot {
  duration: number;
  width: number;
  height: number;
  events: CaptureEvent[];
}

export interface CaptureManifest {
  fps: number;
  shots: Record<string, CaptureShot>;
}

type Point = { x: number; y: number };
const travel = Easing.inOut(Easing.cubic);

/** Where the pointer is `t` seconds into a shot, and whether a button is held. */
export function cursorAt(events: CaptureEvent[], t: number, start: Point = { x: 0.62, y: 0.62 }) {
  let pos = start;
  let down: (Point & { t: number }) | null = null;
  for (const e of events) {
    if (e.t > t) {
      // Between a press and its release the pointer slides straight to the drop point.
      if (down && e.type === "up") {
        const k = (t - down.t) / (e.t - down.t);
        return { x: down.x + (e.x - down.x) * k, y: down.y + (e.y - down.y) * k, pressed: true };
      }
      // Arrive a little before the click the log says followed, as a hand would.
      if (e.type === "move") break;
      continue;
    }
    if (e.type === "move") {
      const arrive = e.t + (e.ms / 1000) * 0.8;
      if (t < arrive) {
        const k = travel((t - e.t) / (arrive - e.t));
        return { x: pos.x + (e.x - pos.x) * k, y: pos.y + (e.y - pos.y) * k, pressed: false };
      }
      pos = { x: e.x, y: e.y };
    } else if (e.type === "down") {
      down = { x: e.x, y: e.y, t: e.t };
      pos = { x: e.x, y: e.y };
    } else if (e.type === "up") {
      down = null;
      pos = { x: e.x, y: e.y };
    } else if (e.type === "click" || e.type === "dblclick") {
      pos = { x: e.x, y: e.y };
    }
  }
  const pressed = events.some((e) => (e.type === "click" || e.type === "dblclick") && t >= e.t - 0.06 && t < e.t + 0.12);
  return { ...pos, pressed: pressed || down !== null };
}

/** Clicks, for the ripple under the pointer. A double-click ripples twice. */
export function clicksOf(events: CaptureEvent[]) {
  return events.flatMap((e) =>
    e.type === "click" || e.type === "down"
      ? [{ t: e.t, x: e.x, y: e.y }]
      : e.type === "dblclick"
        ? [{ t: e.t, x: e.x, y: e.y }, { t: e.t + 0.12, x: e.x, y: e.y }]
        : [],
  );
}

const ZOOM = 1.32;

/** The zoom the camera is heading for at `t`: close while the pointer works, wide otherwise. */
function zoomTarget(events: CaptureEvent[], t: number): { z: number; x: number; y: number } | null {
  let focus: Point | null = null;
  let last: Point | null = null;
  for (const e of events) {
    if (e.type === "click" || e.type === "dblclick" || e.type === "down") last = { x: e.x, y: e.y };
    if ((e.type === "click" || e.type === "dblclick") && t >= e.t - 0.45 && t <= e.t + 1.5) focus = { x: e.x, y: e.y };
    if (e.type === "down" && t >= e.t - 0.45) {
      const up = events.find((u) => u.type === "up" && u.t > e.t);
      if (up && up.type === "up" && t <= up.t + 1.2) {
        const k = Math.min(1, Math.max(0, (t - e.t) / (up.t - e.t)));
        focus = { x: e.x + (up.x - e.x) * k, y: e.y + (up.y - e.y) * k };
      }
    }
    // Typing right after a click keeps the camera on that field.
    if (e.type === "type" && last && t >= e.t && t <= e.t + 2) focus = last;
  }
  return focus ? { z: ZOOM, ...focus } : null;
}

/**
 * The camera at frame `frame`: zoom and the point it zooms around. Eased by
 * running a simple follow from the shot's first frame, so it never jumps and
 * every render of a frame gives the same answer.
 */
export function cameraAt(events: CaptureEvent[], frame: number, fps: number) {
  let z = 1;
  let x = 0.5;
  let y = 0.5;
  const k = 1 - Math.exp(-1 / (0.22 * fps));
  for (let f = 0; f <= frame; f++) {
    const target = zoomTarget(events, f / fps);
    z += ((target ? target.z : 1) - z) * k;
    if (target) {
      x += (target.x - x) * k;
      y += (target.y - y) * k;
    }
  }
  return { z, x, y };
}
