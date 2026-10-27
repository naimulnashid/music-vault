/** App mark (matches the installer icon: violet tile, record, white notes) + wordmark. */
export function LogoMark({ className = "w-8 h-8" }: { className?: string }) {
  // Kept in step with apps/site/public/favicon.svg, the icon's source.
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden>
      <defs>
        <linearGradient id="mv-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#6d28d9" />
        </linearGradient>
        <radialGradient id="mv-logo-gl" cx=".22" cy=".12" r=".85">
          <stop offset="0" stopColor="#fff" stopOpacity=".3" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="512" height="512" rx="120" fill="url(#mv-logo-g)" />
      <rect width="512" height="512" rx="120" fill="url(#mv-logo-gl)" />
      <circle cx="256" cy="256" r="184" fill="#4c1d95" fillOpacity=".3" />
      <circle cx="256" cy="256" r="152" fill="none" stroke="#fff" strokeOpacity=".12" strokeWidth="7" />
      <circle cx="256" cy="256" r="118" fill="none" stroke="#fff" strokeOpacity=".12" strokeWidth="7" />
      <g transform="translate(8 12)" fill="#2e1065" fillOpacity=".4" stroke="#2e1065" strokeOpacity=".4">
        <Notes />
      </g>
      <g fill="#fff" stroke="#fff">
        <Notes />
      </g>
    </svg>
  );
}

function Notes() {
  return (
    <>
      <path d="M214 340V166l140-30v170" fill="none" strokeWidth="36" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx="180" cy="342" rx="44" ry="35" transform="rotate(-20 180 342)" stroke="none" />
      <ellipse cx="320" cy="310" rx="44" ry="35" transform="rotate(-20 320 310)" stroke="none" />
    </>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`items-center gap-2 select-none ${className}`}>
      <LogoMark className="w-7 h-7" />
      <span className="text-[17px] font-bold tracking-tight">Music Vault</span>
    </div>
  );
}
