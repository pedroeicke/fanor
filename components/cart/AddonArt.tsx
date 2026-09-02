/**
 * Ilustrações dos complementos.
 *
 * Desenhadas em SVG em vez de fotos de banco de imagens: são itens simples,
 * e um desenho na paleta da marca fica mais coerente que uma foto genérica
 * que não é do produto real. Trocar por fotos de estúdio quando existirem.
 */
export function AddonArt({ art, className = "" }: { art: "velas" | "tarjeta" | "vela-numero"; className?: string }) {
  if (art === "velas") {
    return (
      <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
        {[
          { x: 10, c: "#D9451F" },
          { x: 17, c: "#F7C118" },
          { x: 24, c: "#3F7A55" },
          { x: 31, c: "#B07AC2" },
          { x: 38, c: "#4A90D9" },
        ].map((v, i) => (
          <g key={v.x}>
            <rect x={v.x - 2.5} y={16 + (i % 2) * 3} width="5" height={24 - (i % 2) * 3} rx="2.5" fill={v.c} />
            <path
              d={`M${v.x} ${11 + (i % 2) * 3}c2 2 2.5 3.5 0 5-2.5-1.5-2-3-0-5Z`}
              fill="#F7C118"
              stroke="#E2A900"
              strokeWidth="0.8"
            />
          </g>
        ))}
      </svg>
    );
  }

  if (art === "vela-numero") {
    return (
      <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
        <path d="M24 8c2.5 2.5 3 4.5 0 6.5-3-2-2.5-4 0-6.5Z" fill="#F7C118" stroke="#E2A900" strokeWidth="1" />
        <text
          x="24"
          y="38"
          textAnchor="middle"
          fontSize="24"
          fontWeight="700"
          fontFamily="Georgia, serif"
          fill="#E2A900"
        >
          5
        </text>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <rect x="7" y="12" width="34" height="25" rx="3" fill="#FDF7EA" stroke="#F0E2C8" strokeWidth="1.5" />
      <path d="M14 21h20M14 26h14" stroke="#A98D74" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M32 28c1.6-1.8 3.5-1.8 4 0-.5 1.8-2.4 1.8-4 0Z"
        fill="#D9451F"
        opacity=".8"
      />
    </svg>
  );
}
