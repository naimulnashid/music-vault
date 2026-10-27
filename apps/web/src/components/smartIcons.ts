import type { ComponentType } from "react";
import {
  CalendarClock,
  CalendarPlus,
  CircleOff,
  Clock,
  Flame,
  Globe,
  Heart,
  Languages,
  Mic,
  Smile,
  Tags,
  Users,
} from "lucide-react";
import type { SmartKey } from "@musicvault/core";

export type IconType = ComponentType<{ className?: string; strokeWidth?: number }>;

export const SMART_ICONS: Record<SmartKey, IconType> = {
  recentlyAdded: CalendarPlus,
  recentlyPlayed: Clock,
  mostPlayed: Flame,
  favorites: Heart,
  neverPlayed: CircleOff,
  genre: Tags,
  artist: Users,
  year: CalendarClock,
  language: Languages,
  country: Globe,
  mood: Smile,
  vocals: Mic,
};

/** Gradient behind each smart collection's cover tile. */
export const SMART_GRADIENTS: Record<SmartKey, string> = {
  recentlyAdded: "from-sky-500 to-indigo-600",
  recentlyPlayed: "from-violet-500 to-indigo-700",
  mostPlayed: "from-orange-500 to-rose-600",
  favorites: "from-violet-500 to-fuchsia-600",
  neverPlayed: "from-slate-500 to-slate-700",
  genre: "from-emerald-500 to-teal-700",
  artist: "from-pink-500 to-violet-600",
  year: "from-amber-500 to-orange-700",
  language: "from-cyan-500 to-blue-700",
  country: "from-lime-500 to-emerald-700",
  mood: "from-rose-400 to-pink-700",
  vocals: "from-indigo-400 to-purple-700",
};
