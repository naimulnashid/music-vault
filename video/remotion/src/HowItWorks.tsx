import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop, C, ease, FONT, pop, popStyle, riseStyle } from "./theme";

const title: React.SVGProps<SVGTextElement> = { fill: C.fg, fontSize: 18, fontWeight: 750 };
const sub: React.SVGProps<SVGTextElement> = { fill: C.muted, fontSize: 14, fontWeight: 500 };
const label: React.SVGProps<SVGTextElement> = { fill: C.fg, fontSize: 13.5, fontWeight: 650 };
const box: React.SVGProps<SVGRectElement> = { fill: C.surface, stroke: C.lineStrong, strokeWidth: 1.5 };

const APPS = [
  { name: "Windows app", stack: "Tauri 2 · React · Rust" },
  { name: "Android app", stack: "Kotlin · Compose · Media3" },
  { name: "Web app", stack: "Next.js · PWA" },
];

export const HowItWorks: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const e = (at: number, dur?: number) => ease(frame, fps, at, dur);
  const p = (at: number) => popStyle(pop(frame, fps, at));
  const r = (at: number) => riseStyle(e(at));
  const fade = (at: number) => ({ opacity: e(at, 0.6) });

  /** An edge drawn from its start, 0.6 s from `at`. */
  const Edge = ({ at, accent, ...xy }: { at: number; accent?: boolean; x1: number; y1: number; x2: number; y2: number }) => (
    <line
      {...xy}
      pathLength={1}
      stroke={accent ? C.accent : "currentColor"}
      strokeWidth={1.75}
      strokeDasharray={1}
      strokeDashoffset={1 - e(at, 0.6)}
    />
  );

  /** Round dots marching along an edge, one way or back, once it is drawn. */
  const Flow = ({ at, back, y }: { at: number; back?: boolean; y: number }) => (
    <line
      x1={268}
      y1={y}
      x2={482}
      y2={y}
      fill="none"
      stroke={C.accentText}
      strokeWidth={3.5}
      strokeLinecap="round"
      strokeDasharray="0.1 18"
      strokeDashoffset={((back ? 1 : -1) * 18.1 * t) / 0.8}
      opacity={e(at, 0.5)}
    />
  );

  const Head = ({ at, points, accent }: { at: number; points: string; accent?: boolean }) => (
    <polygon points={points} fill={accent ? C.accent : "currentColor"} style={p(at)} />
  );

  // The vault lands with one pulse: it is the part the viewer owns.
  const pulse = interpolate(t, [5.75, 6.95], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <Backdrop>
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 84 }}>
        <p
          style={{ margin: "0 0 18px", color: C.accentText, fontSize: 26, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", ...r(0.1) }}
        >
          How it works
        </p>
        <h2 style={{ margin: "0 0 64px", fontSize: 64, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.05, ...r(0.3) }}>
          No shared server. Just your own two accounts.
        </h2>

        {/* The landing page's wide diagram (apps/site/src/components/HowItWorks.astro), built up one part at a time. */}
        <svg viewBox="0 0 760 400" style={{ width: 1360, height: "auto", overflow: "visible", color: C.muted, fontFamily: FONT }}>
          <g style={fade(1.0)}>
            <rect x="1" y="1" width="250" height="398" rx="18" fill="none" stroke={C.lineStrong} strokeWidth={1.5} strokeDasharray="6 6" />
            <text x="20" y="28" fill={C.accentText} fontSize={11} fontWeight={800} letterSpacing="0.1em">
              YOUR DEVICES
            </text>
          </g>
          {APPS.map((app, i) => {
            const s = e(1.25 + i * 0.2, 0.7);
            return (
              <g key={app.name} style={{ opacity: s, transform: `translateX(${(1 - s) * -24}px)` }}>
                <rect {...box} x="16" y={44 + i * 104} width="220" height="88" rx="12" />
                <text {...title} x="34" y={80 + i * 104}>
                  {app.name}
                </text>
                <text {...sub} x="34" y={106 + i * 104}>
                  {app.stack}
                </text>
              </g>
            );
          })}

          {/* Sync with Supabase, both ways */}
          <Edge at={2.3} x1={252} y1={60} x2={498} y2={60} />
          <Head at={2.75} points="498,60 487,55.5 487,64.5" />
          <Head at={2.75} points="252,60 263,55.5 263,64.5" />
          <text {...label} x="375" y="38" textAnchor="middle" style={r(2.6)}>
            sync
          </text>
          <g style={p(2.7)}>
            <rect {...box} x="500" y="0" width="259" height="120" rx="12" />
            <text {...title} x="520" y="36">
              Supabase
            </text>
            <text {...sub} x="520" y="64">
              account · song details · playlists
            </text>
            <text {...sub} x="520" y="88">
              play history · sync state
            </text>
          </g>
          <Flow at={3.1} y={53} />
          <Flow at={3.1} y={67} back />

          {/* Ask the vault function for a signed URL */}
          <Edge at={3.7} x1={252} y1={200} x2={498} y2={200} />
          <Head at={4.15} points="498,200 487,195.5 487,204.5" />
          <text {...label} x="375" y="184" textAnchor="middle" style={r(4.0)}>
            ask for a signed URL
          </text>
          <g style={p(4.1)}>
            <rect {...box} x="500" y="160" width="259" height="80" rx="12" />
            <text {...title} x="520" y="194">
              vault function
            </text>
            <text {...sub} x="520" y="220">
              signs short-lived URLs
            </text>
          </g>
          <Flow at={4.5} y={200} />

          {/* Only the function holds the R2 keys */}
          <Edge at={5.0} x1={630} y1={242} x2={630} y2={292} />
          <Head at={5.35} points="630,292 625.5,281 634.5,281" />
          <text {...label} x="642" y="272" style={r(5.2)}>
            holds the R2 keys
          </text>
          {pulse > 0 && pulse < 1 && (
            <rect
              x="500"
              y="296"
              width="259"
              height="88"
              rx="12"
              fill="none"
              stroke={C.accent}
              strokeWidth={2}
              opacity={0.9 * (1 - pulse)}
              style={{ transformBox: "fill-box", transformOrigin: "center", transform: `scale(${1 + 0.25 * pulse}, ${1 + 0.6 * pulse})` }}
            />
          )}
          <g style={p(5.4)}>
            <rect x="500" y="296" width="259" height="88" rx="12" fill="rgb(139 92 246 / 0.1)" stroke={C.accent} strokeWidth={1.5} />
            <text {...title} x="520" y="332">
              Cloudflare R2
            </text>
            <text {...sub} x="520" y="358">
              your audio and covers
            </text>
          </g>

          {/* Audio goes straight between the device and the vault */}
          <Edge at={6.4} accent x1={252} y1={340} x2={498} y2={340} />
          <Head at={6.85} accent points="498,340 487,335.5 487,344.5" />
          <Head at={6.85} accent points="252,340 263,335.5 263,344.5" />
          <text {...label} x="375" y="318" textAnchor="middle" style={r(6.7)}>
            upload and download audio
          </text>
          <Flow at={7.1} y={333} />
          <Flow at={7.1} y={347} back />

          <text x="126" y="378" textAnchor="middle" fill={C.muted} fontSize={12.5} fontStyle="italic" style={fade(7.8)}>
            Each keeps a local copy and works offline
          </text>
        </svg>
      </AbsoluteFill>
    </Backdrop>
  );
};
