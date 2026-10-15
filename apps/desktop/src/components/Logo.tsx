/** App mark (matches the installer icon: violet tile, white notes) + wordmark. */
export function LogoMark({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="mv-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#mv-logo-g)" />
      <path
        d="M13 21.5V10.2l9-1.9v11.1"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <ellipse cx="10.9" cy="21.6" rx="2.6" ry="2.1" fill="#fff" />
      <ellipse cx="19.9" cy="19.6" rx="2.6" ry="2.1" fill="#fff" />
    </svg>
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
