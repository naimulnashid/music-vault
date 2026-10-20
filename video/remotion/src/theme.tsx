import { useEffect, useState } from "react";
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/** The landing page's dark tokens (apps/site/src/styles/global.css). */
export const C = {
  bg: "#0d0d10",
  surface: "#16161b",
  lineStrong: "rgba(255,255,255,0.14)",
  fg: "#f4f4f7",
  muted: "#a2a2ae",
  accent: "#8b5cf6",
  accentStrong: "#7c3aed",
  accentText: "#b79cfb",
  glow1: "rgba(139,92,246,0.32)",
  glow2: "rgba(192,38,211,0.18)",
};

export const FONT = "'Figtree Variable', 'Segoe UI', system-ui, sans-serif";

const siteEase = Easing.bezier(0.16, 1, 0.3, 1);

/** 0 to 1 over `dur` seconds from `at`, on the site's ease-out curve. */
export function ease(frame: number, fps: number, at: number, dur = 0.8): number {
  return interpolate(frame, [at * fps, (at + dur) * fps], [0, 1], {
    easing: siteEase,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

/** A physical spring from `at` seconds: overshoots a little, then settles. */
export function pop(frame: number, fps: number, at: number, damping = 11): number {
  return spring({ frame: Math.max(0, frame - at * fps), fps, config: { damping, stiffness: 170, mass: 0.7 } });
}

export const riseStyle = (p: number): React.CSSProperties => ({
  opacity: p,
  transform: `translateY(${(1 - p) * 32}px)`,
  filter: `blur(${(1 - p) * 6}px)`,
});

export const popStyle = (s: number): React.CSSProperties => ({
  opacity: Math.min(1, s * 1.6),
  transform: `scale(${0.6 + 0.4 * s})`,
  transformBox: "fill-box",
  transformOrigin: "center",
});

/** Holds the render until Figtree has loaded, so no frame uses a fallback font. */
function useFonts() {
  const [handle] = useState(() => delayRender("Figtree"));
  useEffect(() => {
    Promise.all([500, 650, 700, 750, 800].map((w) => document.fonts.load(`${w} 40px "Figtree Variable"`))).then(() =>
      continueRender(handle),
    );
  }, [handle]);
}

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** Background, drifting glows and grain shared by every clip. */
export const Backdrop: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useFonts();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeIn = interpolate(frame, [0, 1.2 * fps], [0, 1], { extrapolateRight: "clamp" });
  // One slow sweep across 12 s, eased at both ends like the CSS drift.
  const d = Easing.inOut(Easing.sin)(Math.min(1, frame / (12 * fps)));
  const glow: React.CSSProperties = { position: "absolute", borderRadius: "50%", filter: "blur(120px)", opacity: fadeIn };
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.fg, fontFamily: FONT, WebkitFontSmoothing: "antialiased" }}>
      <div
        style={{ ...glow, width: 900, height: 700, left: 260, top: 40, background: C.glow1, transform: `translate(${120 * d}px, ${60 * d}px) scale(${1 + 0.12 * d})` }}
      />
      <div
        style={{ ...glow, width: 800, height: 640, right: 180, bottom: -40, background: C.glow2, transform: `translate(${120 * (1 - d)}px, ${60 * (1 - d)}px) scale(${1 + 0.12 * (1 - d)})` }}
      />
      {children}
      {/* Grain breaks up the glows' banding in 8-bit video. */}
      <AbsoluteFill style={{ backgroundImage: GRAIN, opacity: 0.07 }} />
    </AbsoluteFill>
  );
};
