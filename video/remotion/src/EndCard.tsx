import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop, C, ease, pop, popStyle, riseStyle } from "./theme";

const LINKS = ["github.com/naimulnashid/music-vault", "music-vault-site.vercel.app"];

export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const r = (at: number) => riseStyle(ease(frame, fps, at));

  return (
    <Backdrop>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 0 }}>
        <svg viewBox="0 0 32 32" width={120} height={120} style={{ ...popStyle(pop(frame, fps, 0.15, 12)), filter: "drop-shadow(0 24px 48px rgb(124 58 237 / 0.45))" }}>
          <defs>
            <linearGradient id="end-logo" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#a78bfa" />
              <stop offset="1" stopColor="#7c3aed" />
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="8" fill="url(#end-logo)" />
          <path d="M13 21.5V10.2l9-1.9v11.1" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
          <ellipse cx="10.9" cy="21.6" rx="2.6" ry="2.1" fill="#fff" />
          <ellipse cx="19.9" cy="19.6" rx="2.6" ry="2.1" fill="#fff" />
        </svg>
        <h1 style={{ margin: "40px 0 0", fontSize: 96, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1, ...r(0.35) }}>Music Vault</h1>
        <p style={{ margin: "26px 0 0", fontSize: 40, fontWeight: 500, color: C.muted, ...r(0.55) }}>
          Free and open source. <span style={{ color: C.accentText, fontWeight: 700 }}>Run your own.</span>
        </p>
        <div style={{ display: "flex", gap: 18, marginTop: 54 }}>
          {LINKS.map((link, i) => (
            <span
              key={link}
              style={{
                padding: "14px 28px",
                border: `1.5px solid ${C.lineStrong}`,
                borderRadius: 999,
                background: "rgb(22 22 27 / 0.7)",
                fontSize: 30,
                fontWeight: 650,
                ...popStyle(pop(frame, fps, 0.9 + i * 0.15)),
              }}
            >
              {link}
            </span>
          ))}
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};
