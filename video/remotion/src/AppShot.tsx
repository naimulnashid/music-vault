import { AbsoluteFill, interpolate, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { cameraAt, type CaptureShot, clicksOf, cursorAt } from "./capture";
import { Backdrop, C, ease, riseStyle } from "./theme";

export interface Caption {
  from: number;
  to: number;
  text: string;
}

// The app window: 1600x900 (the footage is 1920x1080, scaled by 5/6), with room
// below it for the caption.
const WIN = { width: 1600, height: 900, top: 28 };
const CURSOR = 30;

/** A macOS-style pointer, drawn rather than recorded: headless capture has none. */
const Pointer: React.FC<{ pressed: boolean }> = ({ pressed }) => (
  <svg
    width={CURSOR}
    height={CURSOR}
    viewBox="0 0 24 24"
    style={{ overflow: "visible", transform: `scale(${pressed ? 0.86 : 1})`, transformOrigin: "3px 2px", filter: "drop-shadow(0 3px 6px rgb(0 0 0 / 0.45))" }}
  >
    <path d="M3 2l15.5 9.3-6.6 1.4 3.9 7.4-2.6 1.4-3.9-7.4L4.4 18.8z" fill="#fff" stroke="#111" strokeWidth={1.4} strokeLinejoin="round" />
  </svg>
);

/**
 * One web shot. `start` plays it from that many seconds in (the landing page
 * loop uses short pieces); `top` moves the window, centred when there are no
 * captions under it.
 */
export const AppShot: React.FC<{ name: string; shot: CaptureShot; captions: Caption[]; start?: number; top?: number }> = ({
  name,
  shot,
  captions,
  start = 0,
  top = WIN.top,
}) => {
  const { fps } = useVideoConfig();
  const skip = Math.round(start * fps);
  const frame = useCurrentFrame() + skip;
  const t = frame / fps;
  const cam = cameraAt(shot.events, frame, fps);
  const cur = cursorAt(shot.events, t);

  return (
    <Backdrop>
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            left: (1920 - WIN.width) / 2,
            top,
            width: WIN.width,
            height: WIN.height,
            borderRadius: 18,
            overflow: "hidden",
            boxShadow: "0 50px 120px -30px rgb(0 0 0 / 0.9), 0 0 0 1px rgb(255 255 255 / 0.1)",
            transform: `scale(${cam.z})`,
            transformOrigin: `${cam.x * 100}% ${cam.y * 100}%`,
          }}
        >
          <OffthreadVideo src={staticFile(`capture/web/${name}.mp4`)} trimBefore={skip || undefined} muted style={{ width: "100%", height: "100%" }} />

          {clicksOf(shot.events).map((c, i) => {
            const p = interpolate(t, [c.t, c.t + 0.5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            if (p <= 0 || p >= 1) return null;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: c.x * WIN.width - 26,
                  top: c.y * WIN.height - 26,
                  width: 52,
                  height: 52,
                  borderRadius: "50%",
                  border: `3px solid ${C.accent}`,
                  background: "rgb(139 92 246 / 0.18)",
                  opacity: 1 - p,
                  transform: `scale(${0.3 + p * 0.9})`,
                }}
              />
            );
          })}

          <div style={{ position: "absolute", left: cur.x * WIN.width - 4, top: cur.y * WIN.height - 3 }}>
            <Pointer pressed={cur.pressed} />
          </div>
        </div>
      </AbsoluteFill>

      {captions.map((c) => (
        <CaptionLine key={c.text} caption={c} top={top + WIN.height + 30} start={start} />
      ))}
    </Backdrop>
  );
};

/** One caption under the footage: rises in, fades out, on a dark pill. */
export const CaptionLine: React.FC<{ caption: Caption; top: number; start?: number }> = ({ caption: c, top, start = 0 }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame() + Math.round(start * fps);
  const t = frame / fps;
  if (t < c.from || t > c.to) return null;
  const inP = ease(frame, fps, c.from, 0.6);
  const outP = ease(frame, fps, c.to - 0.4, 0.4);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top, textAlign: "center", ...riseStyle(inP), opacity: inP * (1 - outP) }}>
      {/* A dark pill keeps the caption readable when a zoom pushes the window under it. */}
      <span
        style={{
          display: "inline-block",
          padding: "10px 28px",
          borderRadius: 999,
          background: "rgb(13 13 16 / 0.82)",
          boxShadow: "0 0 0 1px rgb(255 255 255 / 0.08)",
          fontSize: 40,
          fontWeight: 700,
          letterSpacing: "-0.015em",
        }}
      >
        {c.text}
      </span>
    </div>
  );
};
