// Original pixel "RSP" mark. Replace with the official RSP Supply logo by dropping
// an SVG/PNG at client/public/brand/logo.svg and swapping the <svg> below for an <img>.
export function Logo({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const big = size === 'lg';
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 16 16" shapeRendering="crispEdges" className={big ? 'h-14 w-14' : 'h-8 w-8'} aria-hidden>
        <rect width="16" height="16" rx="3" fill="#123a6b" />
        <path d="M3 4h4v1h1v3H7v1h1v3H6V9H5v3H3zm2 1v3h1V5z" fill="#fff" />
        <path d="M9 4h4v2h-2v1h2v5H9v-2h2V9H9z" fill="#f26b1d" />
      </svg>
      <div className="leading-tight">
        <div className={`font-extrabold tracking-wide text-white ${big ? 'text-2xl' : 'text-sm'}`}>RSP SUPPLY</div>
        <div className={`font-medium text-accent-400 ${big ? 'text-sm' : 'text-[11px]'}`}>Virtual Office</div>
      </div>
    </div>
  );
}
