type ZcodeLogoProps = {
  className?: string;
};

/** ZCode (Zhipu) logo: a rounded tile with a stylized Z bolt. */
export default function ZcodeLogo({ className = 'w-5 h-5' }: ZcodeLogoProps) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="ZCode">
      <defs>
        <linearGradient id="zcode-logo-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="7" fill="url(#zcode-logo-gradient)" />
      <path
        d="M10 10.5h12L14.5 16H22L12 25l3.2-6.4H10.8L16 12.6h-6z"
        fill="#fff"
        stroke="#fff"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
