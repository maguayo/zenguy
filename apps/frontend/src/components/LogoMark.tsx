export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect fill="#14110D" height="30" rx="9" width="30" x="1" y="1" />
      <path
        d="M9 10.5 Q 12 9.5 16 10.5 T 23 10.5 L 9 21.5 Q 12 22.5 16 21.5 T 23 21.5"
        fill="none"
        stroke="#FCFAF6"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <circle cx="23" cy="21.5" fill="#615ED6" r="1.6" />
    </svg>
  );
}
