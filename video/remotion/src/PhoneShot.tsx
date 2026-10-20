import { AbsoluteFill, interpolate, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Caption } from "./AppShot";
import { CaptionLine } from "./AppShot";
import type { CaptureShot } from "./capture";
import { Backdrop, C, pop } from "./theme";

// Same band as the web shots: the device fills the top 900px, captions sit below.
const AREA = { top: 28, height: 900 };
const BEZEL = 14;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const FINGER = 64;

/** Where a fingertip is at `t`, from the logged taps and swipes, or null when nothing touches. */
function touchAt(events: CaptureShot["events"], t: number) {
  for (const e of events) {
    if (e.type === "tap" && t >= e.t - 0.12 && t <= e.t + 0.35) {
      return { x: e.x, y: e.y, alpha: interpolate(t, [e.t - 0.12, e.t, e.t + 0.15, e.t + 0.35], [0, 1, 1, 0], clamp), ripple: e.t };
    }
    if (e.type === "swipe") {
      const end = e.t + e.ms / 1000;
      if (t >= e.t - 0.12 && t <= end + 0.2) {
        const k = interpolate(t, [e.t, end], [0, 1], clamp);
        return {
          x: e.x + (e.to.x - e.x) * k,
          y: e.y + (e.to.y - e.y) * k,
          alpha: interpolate(t, [e.t - 0.12, e.t, end, end + 0.2], [0, 1, 1, 0], clamp),
          ripple: null,
        };
      }
    }
  }
  return null;
}

/** The emulator footage in a drawn phone, with each logged touch drawn as a fingertip. */
export const PhoneShot: React.FC<{ shot: CaptureShot; captions: Caption[]; start?: number; top?: number }> = ({
  shot,
  captions,
  start = 0,
  top = AREA.top,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const skip = Math.round(start * fps);
  const screenH = AREA.height - BEZEL * 2;
  const screenW = Math.round((screenH * shot.width) / shot.height);
  const s = pop(frame, fps, 0, 14);
  const t = (frame + skip) / fps;
  const touch = touchAt(shot.events, t);
  const ripple = touch?.ripple != null ? interpolate(t, [touch.ripple, touch.ripple + 0.35], [0, 1], clamp) : 0;

  return (
    <Backdrop>
      <AbsoluteFill>
        <div
          style={{
            position: "absolute",
            top,
            left: (1920 - screenW - BEZEL * 2) / 2,
            width: screenW + BEZEL * 2,
            height: AREA.height,
            padding: BEZEL,
            borderRadius: 64,
            background: "linear-gradient(160deg, #2a2a33, #111116)",
            boxShadow: "0 60px 120px -30px rgb(0 0 0 / 0.9), inset 0 0 0 2px rgb(255 255 255 / 0.08)",
            opacity: Math.min(1, s * 1.5),
            transform: `translateY(${(1 - s) * 80}px)`,
          }}
        >
          <div style={{ position: "relative", width: screenW, height: screenH, borderRadius: 50, overflow: "hidden", background: "#000" }}>
            <OffthreadVideo src={staticFile("capture/android/phone.mp4")} trimBefore={skip || undefined} muted style={{ width: "100%", height: "100%" }} />
            {touch && (
              <>
                {ripple > 0 && ripple < 1 && (
                  <div
                    style={{
                      position: "absolute",
                      left: touch.x * screenW - FINGER / 2,
                      top: touch.y * screenH - FINGER / 2,
                      width: FINGER,
                      height: FINGER,
                      borderRadius: "50%",
                      border: `3px solid ${C.accent}`,
                      opacity: 1 - ripple,
                      transform: `scale(${1 + ripple * 0.9})`,
                    }}
                  />
                )}
                <div
                  style={{
                    position: "absolute",
                    left: touch.x * screenW - FINGER / 2,
                    top: touch.y * screenH - FINGER / 2,
                    width: FINGER,
                    height: FINGER,
                    borderRadius: "50%",
                    background: "rgb(255 255 255 / 0.35)",
                    boxShadow: "0 0 0 2px rgb(255 255 255 / 0.55), 0 6px 18px rgb(0 0 0 / 0.35)",
                    opacity: touch.alpha,
                  }}
                />
              </>
            )}
          </div>
        </div>
      </AbsoluteFill>
      {captions.map((c) => (
        <CaptionLine key={c.text} caption={c} top={top + AREA.height + 30} start={start} />
      ))}
    </Backdrop>
  );
};
