import { AbsoluteFill, Audio, type CalculateMetadataFunction, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { AppShot, type Caption } from "./AppShot";
import type { CaptureManifest, CaptureShot } from "./capture";
import { EndCard } from "./EndCard";
import { HowItWorks } from "./HowItWorks";
import { PhoneShot } from "./PhoneShot";
import { Title } from "./Title";

export const FPS = 30;
/** Each part fades in over the end of the one before. */
const OVERLAP = 0.5;

type Part =
  | { kind: "title"; seconds: number }
  | { kind: "shot"; name: string; captions: Caption[] }
  | { kind: "phone"; captions: Caption[] }
  | { kind: "how"; seconds: number }
  | { kind: "end"; seconds: number };

// The storyboard. Shot names match apps/web/scripts/demo-video.mjs and the
// phone shot is apps/android/scripts/demo-video.mjs; caption times are seconds
// into each shot, set against its logged clicks and taps.
const PARTS: Part[] = [
  { kind: "title", seconds: 6 },
  {
    kind: "shot",
    name: "library",
    captions: [
      { from: 0.5, to: 7.0, text: "Browse by song, album, artist, genre, year and language" },
      { from: 7.6, to: 15.3, text: "Search across all of it" },
    ],
  },
  {
    kind: "shot",
    name: "play",
    captions: [
      { from: 0.4, to: 6.0, text: "Your songs, from your own vault" },
      { from: 6.6, to: 13.2, text: "Synced lyrics" },
      { from: 13.8, to: 19.8, text: "A visualizer that follows the music" },
    ],
  },
  {
    kind: "shot",
    name: "playlists",
    captions: [
      { from: 0.4, to: 5.6, text: "Playlists you reorder with a drag" },
      { from: 6.0, to: 9.1, text: "Smart playlists fill themselves from rules" },
    ],
  },
  {
    kind: "phone",
    captions: [
      { from: 0.6, to: 10.8, text: "The same library and player on Android" },
      { from: 11.6, to: 16.6, text: "Your listening history, on every device" },
    ],
  },
  { kind: "shot", name: "offline", captions: [{ from: 0.4, to: 7.4, text: "Played songs stay cached, so nothing downloads twice" }] },
  { kind: "shot", name: "stats", captions: [{ from: 0.4, to: 10.4, text: "Listening time, streaks and six months of history" }] },
  { kind: "shot", name: "theme", captions: [{ from: 0.4, to: 6.3, text: "Dark and light themes" }] },
  { kind: "how", seconds: 10 },
  { kind: "end", seconds: 5 },
];

const MUSIC = "music/vintage_menu.wav";

function layout(manifest: CaptureManifest, phone: CaptureShot | null) {
  let start = 0;
  // Without phone footage the cut simply leaves the phone shot out.
  return PARTS.filter((part) => part.kind !== "phone" || phone).map((part, i) => {
    const seconds =
      part.kind === "shot" ? manifest.shots[part.name].duration : part.kind === "phone" ? phone!.duration : part.seconds;
    const frames = Math.round(seconds * FPS);
    const from = i === 0 ? 0 : start - Math.round(OVERLAP * FPS);
    start = from + frames;
    return { part, from, frames };
  });
}

export interface MainProps extends Record<string, unknown> {
  manifest: CaptureManifest | null;
  phone: CaptureShot | null;
}

/** The footage logs written by the capture scripts; they set the shots' lengths. The phone shot is optional. */
export async function loadCaptures() {
  const res = await fetch(staticFile("capture/web/shots.json"));
  if (!res.ok) throw new Error("No capture/web/shots.json: run `npm run demo:video -w music-vault-web` first.");
  const manifest = (await res.json()) as CaptureManifest;
  const android = await fetch(staticFile("capture/android/shots.json"));
  const phone = android.ok ? ((await android.json()) as CaptureManifest).shots.phone : null;
  return { manifest, phone };
}

export const calculateMainMetadata: CalculateMetadataFunction<MainProps> = async () => {
  const { manifest, phone } = await loadCaptures();
  const parts = layout(manifest, phone);
  const last = parts[parts.length - 1];
  return { durationInFrames: last.from + last.frames, props: { manifest, phone } };
};

const FadeIn: React.FC<{ children: React.ReactNode; first: boolean }> = ({ children, first }) => {
  const frame = useCurrentFrame();
  const opacity = first ? 1 : interpolate(frame, [0, OVERLAP * FPS], [0, 1], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

export const Main: React.FC<MainProps> = ({ manifest, phone }) => {
  const { durationInFrames } = useVideoConfig();
  if (!manifest) return null;
  // The music fades in over a second and out over the last three.
  const volume = (f: number) =>
    0.85 * Math.min(interpolate(f, [0, FPS], [0, 1], { extrapolateRight: "clamp" }), interpolate(f, [durationInFrames - 3 * FPS, durationInFrames], [1, 0], { extrapolateLeft: "clamp" }));

  return (
    <AbsoluteFill style={{ background: "#0d0d10" }}>
      <Audio src={staticFile(MUSIC)} volume={volume} />
      {layout(manifest, phone).map(({ part, from, frames }, i) => (
        <Sequence key={i} from={from} durationInFrames={frames}>
          <FadeIn first={i === 0}>
            {part.kind === "title" && <Title music={MUSIC} />}
            {part.kind === "shot" && <AppShot name={part.name} shot={manifest.shots[part.name]} captions={part.captions} />}
            {part.kind === "phone" && phone && <PhoneShot shot={phone} captions={part.captions} />}
            {part.kind === "how" && <HowItWorks />}
            {part.kind === "end" && <EndCard />}
          </FadeIn>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
