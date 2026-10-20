import { useAudioData, visualizeAudio } from "@remotion/media-utils";
import { AbsoluteFill, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop, C, ease, pop, popStyle, riseStyle } from "./theme";

const WORD = "Music Vault";
const TAGLINE = ["Your", "music,", "in", "your", "own", "vault."];
const CHIPS = ["Windows", "Android", "Web"];

// Fixed pseudo-random bars (Park-Miller) for when there is no music to follow.
const BARS = (() => {
  let s = 7;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 72 }, () => ({ h: 0.3 + rand() * 0.7, t: 0.35 + rand() * 0.5, o: rand() }));
})();

/** A quiet equalizer along the bottom edge, there for the music. */
const Bars: React.FC<{ spectrum: number[] | null; opacity: number }> = ({ spectrum, opacity }) => {
  const t = useCurrentFrame() / useVideoConfig().fps;
  return (
    <AbsoluteFill
      style={{
        top: "auto",
        height: 150,
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "center",
        gap: 10,
        opacity,
        maskImage: "linear-gradient(to right, transparent, #000 25%, #000 75%, transparent)",
      }}
    >
      {BARS.map((b, i) => {
        // Without music: back and forth between 12% and the bar's own height.
        const phase = (t / b.t + b.o) % 2;
        const k = 0.5 - 0.5 * Math.cos(Math.PI * (phase < 1 ? phase : 2 - phase));
        return (
          <i
            key={i}
            style={{
              width: 14,
              height: "100%",
              borderRadius: "7px 7px 0 0",
              background: `linear-gradient(to top, ${C.accentStrong}, rgb(183 156 251 / 0.4))`,
              transformOrigin: "bottom",
              transform: `scaleY(${spectrum ? spectrum[i] : 0.12 + (b.h - 0.12) * k})`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/** The bars following `music`: its spectrum mirrored, bass in the middle. */
const MusicBars: React.FC<{ music: string; opacity: number }> = ({ music, opacity }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const audioData = useAudioData(staticFile(music));
  if (!audioData) return null;
  const bins = visualizeAudio({ fps, frame, audioData, numberOfSamples: 64, optimizeFor: "accuracy" });
  const half = BARS.length / 2;
  const spectrum = BARS.map((_, i) => {
    const v = bins[Math.min(bins.length - 1, Math.floor((Math.abs(i + 0.5 - half) / half) * 40))] ?? 0;
    return Math.min(1, 0.12 + Math.sqrt(v) * 1.6);
  });
  return <Bars spectrum={spectrum} opacity={opacity} />;
};

/** `music`: a file in public/ the bars follow (the clip's own soundtrack, from its start). */
export const Title: React.FC<{ music?: string }> = ({ music }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const mark = pop(frame, fps, 0.2, 12);
  const stem = 1 - ease(frame, fps, 0.75, 0.6);
  const ring = interpolate(t, [1.25, 2.35], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const bars = interpolate(t, [3.2, 4.2], [0, 0.55], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <Backdrop>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: 60 }}>
        <div style={{ position: "relative", width: 176, height: 176, marginBottom: 52 }}>
          {ring > 0 && ring < 1 && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                border: `3px solid ${C.accent}`,
                borderRadius: 44,
                opacity: 0.9 * (1 - ring),
                transform: `scale(${1 + 0.7 * ring})`,
              }}
            />
          )}
          {/* The app mark, as in apps/site/src/components/Logo.astro. */}
          <svg
            viewBox="0 0 32 32"
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              overflow: "visible",
              filter: "drop-shadow(0 30px 60px rgb(124 58 237 / 0.45))",
              opacity: Math.min(1, mark * 1.6),
              transform: `scale(${0.45 + 0.55 * mark}) rotate(${-14 * (1 - mark)}deg)`,
            }}
          >
            <defs>
              <linearGradient id="logo" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#a78bfa" />
                <stop offset="1" stopColor="#7c3aed" />
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="8" fill="url(#logo)" />
            <path
              pathLength={1}
              d="M13 21.5V10.2l9-1.9v11.1"
              fill="none"
              stroke="#fff"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={1}
              strokeDashoffset={stem}
            />
            <ellipse cx="10.9" cy="21.6" rx="2.6" ry="2.1" fill="#fff" style={popStyle(pop(frame, fps, 1.15))} />
            <ellipse cx="19.9" cy="19.6" rx="2.6" ry="2.1" fill="#fff" style={popStyle(pop(frame, fps, 1.3))} />
          </svg>
        </div>

        <h1 style={{ margin: 0, fontSize: 136, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1, whiteSpace: "pre" }}>
          {[...WORD].map((ch, i) => {
            const p = ease(frame, fps, 1.15 + i * 0.035, 0.9);
            return (
              <span
                key={i}
                style={{ display: "inline-block", opacity: p, transform: `translateY(${(1 - p) * 60}%)`, filter: `blur(${(1 - p) * 10}px)` }}
              >
                {ch}
              </span>
            );
          })}
        </h1>

        <p style={{ margin: "34px 0 0", color: C.muted, fontSize: 50, fontWeight: 500, letterSpacing: "-0.01em" }}>
          {TAGLINE.map((word, i) => (
            <span
              key={word}
              style={{
                display: "inline-block",
                marginRight: "0.25em",
                ...(i >= 4 ? { color: C.accentText, fontWeight: 700 } : null),
                ...riseStyle(ease(frame, fps, 2.0 + i * 0.08)),
              }}
            >
              {word}
            </span>
          ))}
        </p>

        <div style={{ display: "flex", gap: 18, marginTop: 56 }}>
          {CHIPS.map((chip, i) => (
            <span
              key={chip}
              style={{
                padding: "14px 30px",
                border: `1.5px solid ${C.lineStrong}`,
                borderRadius: 999,
                background: "rgb(22 22 27 / 0.7)",
                fontSize: 28,
                fontWeight: 650,
                ...popStyle(pop(frame, fps, 2.9 + i * 0.12)),
              }}
            >
              {chip}
            </span>
          ))}
        </div>
      </AbsoluteFill>

      {music ? <MusicBars music={music} opacity={bars} /> : <Bars spectrum={null} opacity={bars} />}
    </Backdrop>
  );
};
