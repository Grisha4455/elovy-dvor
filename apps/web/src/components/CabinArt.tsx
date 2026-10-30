// Векторные иллюстрации вместо фотографий: проект выдуманный, реальных снимков нет.

function Fir({ x, h, tone }: { x: number; h: number; tone: string }) {
  const b = 150;
  const w = h * 0.42;
  return (
    <g fill={tone}>
      <path d={`M${x} ${b - h} L${x + w * 0.55} ${b - h * 0.5} H${x - w * 0.55} Z`} />
      <path d={`M${x} ${b - h * 0.72} L${x + w * 0.8} ${b - h * 0.22} H${x - w * 0.8} Z`} />
      <path d={`M${x} ${b - h * 0.45} L${x + w} ${b} H${x - w} Z`} />
    </g>
  );
}

function Forest() {
  return (
    <>
      <Fir x={18} h={70} tone="var(--art-far)" />
      <Fir x={52} h={92} tone="var(--art-far)" />
      <Fir x={262} h={84} tone="var(--art-far)" />
      <Fir x={292} h={66} tone="var(--art-far)" />
      <Fir x={34} h={58} tone="var(--art-near)" />
      <Fir x={276} h={52} tone="var(--art-near)" />
    </>
  );
}

const houses: Record<string, React.ReactNode> = {
  shishka: (
    <g>
      <path d="M160 52 L205 150 H115 Z" fill="var(--art-wood)" />
      <path d="M160 52 L205 150 H196 L160 70 L124 150 H115 Z" fill="var(--art-roof)" />
      <path d="M160 92 L182 140 H138 Z" fill="var(--art-window)" />
      <path d="M160 92 V140 M146 122 H174" stroke="var(--art-wood)" strokeWidth="2.5" />
    </g>
  ),
  "lesnaya-masterskaya": (
    <g>
      <rect x="112" y="92" width="96" height="58" fill="var(--art-wood)" />
      <path d="M104 94 L160 60 L216 94 Z" fill="var(--art-roof)" />
      <rect x="186" y="56" width="10" height="24" fill="var(--art-roof)" />
      <rect x="124" y="106" width="22" height="20" rx="2" fill="var(--art-window)" />
      <rect x="174" y="106" width="22" height="20" rx="2" fill="var(--art-window)" />
      <rect x="151" y="116" width="18" height="34" fill="var(--art-roof)" />
    </g>
  ),
  "medvezhiy-ugol": (
    <g>
      <rect x="100" y="96" width="120" height="54" fill="var(--art-wood)" />
      {[104, 114, 124, 134, 144].map((y) => (
        <line key={y} x1="100" x2="220" y1={y} y2={y} stroke="var(--art-roof)" strokeOpacity=".25" strokeWidth="2" />
      ))}
      <path d="M92 98 L160 58 L228 98 Z" fill="var(--art-roof)" />
      <rect x="112" y="110" width="20" height="18" rx="2" fill="var(--art-window)" />
      <rect x="188" y="110" width="20" height="18" rx="2" fill="var(--art-window)" />
      <rect x="150" y="114" width="20" height="36" fill="var(--art-roof)" />
      <ellipse cx="160" cy="160" rx="120" ry="7" fill="var(--art-water)" />
    </g>
  ),
  "eloviy-terem": (
    <g>
      <rect x="108" y="88" width="104" height="62" fill="var(--art-wood)" />
      <rect x="124" y="60" width="72" height="30" fill="var(--art-wood)" />
      <path d="M100 90 L160 70 L220 90 Z" fill="var(--art-roof)" />
      <path d="M118 62 L160 34 L202 62 Z" fill="var(--art-roof)" />
      <rect x="146" y="66" width="28" height="18" rx="2" fill="var(--art-window)" />
      {[118, 144, 172, 196].map((x) => (
        <rect key={x} x={x} y="102" width="16" height="18" rx="2" fill="var(--art-window)" />
      ))}
      <rect x="150" y="124" width="20" height="26" fill="var(--art-roof)" />
      <path d="M232 150 v-26 h22 v26 M228 126 L243 114 L258 126" fill="var(--art-wood)" stroke="var(--art-roof)" strokeWidth="3" />
    </g>
  ),
};

export function CabinArt({ slug, className }: { slug: string; className?: string }) {
  return (
    <svg viewBox="0 0 320 170" className={className} role="img" aria-hidden="true">
      <rect width="320" height="170" fill="var(--art-sky)" />
      <circle cx="252" cy="40" r="16" fill="var(--art-sun)" />
      <Forest />
      <rect y="150" width="320" height="20" fill="var(--art-ground)" />
      {houses[slug] ?? houses.shishka}
    </svg>
  );
}
