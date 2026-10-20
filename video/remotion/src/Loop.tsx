import { AbsoluteFill, type CalculateMetadataFunction, Freeze, interpolate, Sequence, useCurrentFrame } from "remotion";
import { AppShot } from "./AppShot";
import type { CaptureManifest, CaptureShot } from "./capture";
import { FPS, loadCaptures } from "./Main";
import { PhoneShot } from "./PhoneShot";

/**
 * The landing page's hero loop: about 15 silent seconds of the strongest app
 * moments, no captions (it autoplays muted next to the page's own copy). The
 * last half second fades back to the first frame, so it loops without a seam.
 */
const OVERLAP = 0.5;
// Window centred in the frame: no caption band under it here.
const TOP = 90;

type Piece = { kind: "web"; name: string; from: number; to: number } | { kind: "phone"; from: number; to: number };

// Seconds into each shot, chosen against the shots' logged clicks and taps.
const PIECES: Piece[] = [
  { kind: "web", name: "library", from: 7.2, to: 10.4 }, // search, typing "Mira"
  { kind: "web", name: "play", from: 7.0, to: 11.0 }, // Lyrics tab, lines scrolling
  { kind: "web", name: "play", from: 15.0, to: 18.2 }, // the visualizer
  { kind: "phone", from: 4.8, to: 8.6 }, // mini player into the full player, Play
  { kind: "web", name: "stats", from: 3.6, to: 6.4 }, // statistics scrolling to the heatmap
];

function layout(phone: CaptureShot | null) {
  let start = 0;
  return PIECES.filter((p) => p.kind !== "phone" || phone).map((piece, i) => {
    const frames = Math.round((piece.to - piece.from) * FPS);
    const from = i === 0 ? 0 : start - Math.round(OVERLAP * FPS);
    start = from + frames;
    return { piece, from, frames };
  });
}

export interface LoopProps extends Record<string, unknown> {
  manifest: CaptureManifest | null;
  phone: CaptureShot | null;
}

export const calculateLoopMetadata: CalculateMetadataFunction<LoopProps> = async () => {
  const { manifest, phone } = await loadCaptures();
  const parts = layout(phone);
  const last = parts[parts.length - 1];
  // Ends as the first piece's opening frame finishes fading in over the last one.
  return { durationInFrames: last.from + last.frames, props: { manifest, phone } };
};

/** Fades in over `frames`; `frames` defaults to the overlap between pieces. */
const Fade: React.FC<{ children: React.ReactNode; first: boolean; frames?: number }> = ({ children, first, frames = OVERLAP * FPS }) => {
  const opacity = first ? 1 : interpolate(useCurrentFrame(), [0, frames], [0, 1], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

const PieceView: React.FC<{ piece: Piece; manifest: CaptureManifest; phone: CaptureShot | null }> = ({ piece, manifest, phone }) =>
  piece.kind === "web" ? (
    <AppShot name={piece.name} shot={manifest.shots[piece.name]} captions={[]} start={piece.from} top={TOP} />
  ) : (
    <PhoneShot shot={phone!} captions={[]} start={piece.from} top={TOP} />
  );

export const Loop: React.FC<LoopProps> = ({ manifest, phone }) => {
  if (!manifest) return null;
  const parts = layout(phone);
  const last = parts[parts.length - 1];
  const fade = Math.round(OVERLAP * FPS);
  return (
    <AbsoluteFill style={{ background: "#0d0d10" }}>
      {parts.map(({ piece, from, frames }, i) => (
        <Sequence key={i} from={from} durationInFrames={frames}>
          <Fade first={i === 0}>
            <PieceView piece={piece} manifest={manifest} phone={phone} />
          </Fade>
        </Sequence>
      ))}
      {/* The opening frame, held while it fades in, fully opaque on the very last
          frame: the loop's last frame is its first. */}
      <Sequence from={last.from + last.frames - fade} durationInFrames={fade}>
        <Fade first={false} frames={fade - 1}>
          <Freeze frame={0}>
            <PieceView piece={parts[0].piece} manifest={manifest} phone={phone} />
          </Freeze>
        </Fade>
      </Sequence>
    </AbsoluteFill>
  );
};
