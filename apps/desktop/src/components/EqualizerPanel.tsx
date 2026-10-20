import { PanelHeader } from "./PanelHeader";
import { Toggle } from "./ui/Toggle";
import { Slider } from "./ui/Slider";
import { useSettingsStore } from "../store/settingsStore";
import { EQ_FREQS, EQ_PRESETS } from "../types";
import type { ReplayGainMode } from "../types";

const RG_MODES: { key: ReplayGainMode; label: string }[] = [
  { key: "off", label: "Off" },
  { key: "track", label: "Track" },
  { key: "album", label: "Album" },
];

function formatFreq(freq: number): string {
  return freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
}

function bandLabel(freq: number): string {
  return freq >= 1000 ? `${freq / 1000} kHz gain` : `${freq} Hz gain`;
}

function formatGain(db: number): string {
  return `${db > 0 ? "+" : ""}${db} dB`;
}

export function EqualizerPanel() {
  const eqPreset = useSettingsStore((s) => s.eqPreset);
  const eqBands = useSettingsStore((s) => s.eqBands);
  const setEqPreset = useSettingsStore((s) => s.setEqPreset);
  const setEqBands = useSettingsStore((s) => s.setEqBands);

  const gapless = useSettingsStore((s) => s.gapless);
  const setGapless = useSettingsStore((s) => s.setGapless);
  const crossfadeDuration = useSettingsStore((s) => s.crossfadeDuration);
  const setCrossfadeDuration = useSettingsStore((s) => s.setCrossfadeDuration);
  const replayGainMode = useSettingsStore((s) => s.replayGainMode ?? "off");
  const setReplayGainMode = useSettingsStore((s) => s.setReplayGainMode);

  const updateBand = (index: number, value: number) => {
    const next = [...eqBands];
    next[index] = value;
    setEqBands(next);
  };

  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Sound" />
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pb-4">
          <select
            value={eqPreset}
            onChange={(e) => setEqPreset(e.target.value)}
            aria-label="Equalizer preset"
            className="mv-field"
          >
            {Object.keys(EQ_PRESETS).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            {eqPreset === "Custom" && <option value="Custom">Custom</option>}
          </select>
        </div>
        <div className="h-56 flex items-end justify-between gap-2 px-4 pb-4">
          {EQ_FREQS.map((freq, i) => (
            <div key={freq} className="flex flex-col items-center gap-2 h-full">
              <span className="text-xs text-muted tabular-nums">{eqBands[i]?.toFixed(0)}</span>
              <input
                type="range"
                min={-12}
                max={12}
                step={1}
                value={eqBands[i] ?? 0}
                onChange={(e) => updateBand(i, Number(e.target.value))}
                aria-label={bandLabel(freq)}
                aria-valuetext={formatGain(eqBands[i] ?? 0)}
                className="flex-1 w-2"
                style={{ writingMode: "vertical-lr", direction: "rtl" }}
              />
              <span className="text-[10px] text-muted">{formatFreq(freq)}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-line px-5 py-4 space-y-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-subtle">Playback</div>

          <Toggle
            checked={gapless}
            onChange={setGapless}
            label="Gapless"
            hint="Preload the next song for seamless transitions"
          />

          <div>
            <div className="flex items-center justify-between text-sm">
              <span>Crossfade</span>
              <span className="text-muted tabular-nums">
                {crossfadeDuration === 0 ? "Off" : `${crossfadeDuration}s`}
              </span>
            </div>
            <Slider
              label="Crossfade"
              value={crossfadeDuration}
              max={12}
              step={1}
              onChange={(v) => setCrossfadeDuration(Math.round(v))}
              formatTooltip={(v) => (Math.round(v) === 0 ? "Off" : `${Math.round(v)}s`)}
              className="mt-2"
            />
            <div className="text-xs text-muted mt-1">
              Overlap and fade between tracks. Overrides gapless when above 0.
            </div>
          </div>

          <div>
            <div className="text-sm">ReplayGain</div>
            <div className="grid grid-flow-col auto-cols-fr gap-1 p-1 rounded-xl bg-surface-2 mt-2">
              {RG_MODES.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setReplayGainMode(key)}
                  className={`h-8 rounded-lg text-xs font-semibold transition-colors ${
                    replayGainMode === key ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="text-xs text-muted mt-1">
              Evens out loudness using the file&apos;s ReplayGain tags; untagged tracks play unchanged.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
