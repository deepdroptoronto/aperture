'use client';

import { useId, type CSSProperties } from 'react';

export type MascotState = 'idle' | 'walk' | 'celebrate';

export interface MascotProps {
  /** Pose and animation set. */
  state?: MascotState;
  /** Rendered edge length in pixels. */
  size?: number;
  /** Accessible label. Defaults to a description of the current state. */
  label?: string;
  /** Shield colour. */
  color?: string;
  /** Trim, emblem and sparkle colour. */
  accent?: string;
  className?: string;
  style?: CSSProperties;
  /** Render a static pose even when motion is allowed. */
  disableAnimations?: boolean;
}

const LABELS: Record<MascotState, string> = {
  idle: 'Angel Armor mascot, standing guard',
  walk: 'Angel Armor mascot, walking',
  celebrate: 'Angel Armor mascot, celebrating',
};

/**
 * Mascot — the UI Cassette's mascot.
 *
 * Three states, no images, no external stylesheet: the keyframes are scoped by
 * an instance id so the component cannot leak styles into a host app. Motion is
 * disabled automatically when the OS asks for reduced motion.
 */
export function Mascot({
  state = 'idle',
  size = 96,
  label,
  color = '#e8ecf5',
  accent = '#eab308',
  className,
  style,
  disableAnimations = false,
}: MascotProps) {
  const scope = `aaui-mascot-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const classes = [scope, state, disableAnimations ? 'static' : '', className].filter(Boolean).join(' ');

  const css = `
.${scope} { display: inline-block; line-height: 0; contain: layout paint; }
.${scope} svg { display: block; overflow: visible; }
.${scope} .shell { animation: ${scope}-bob 2.8s ease-in-out infinite; transform-origin: 32px 48px; }
.${scope} .leg-a, .${scope} .leg-b { transform-box: fill-box; transform-origin: 50% 0%; }
.${scope} .spark { opacity: 0; transform-box: fill-box; transform-origin: 50% 50%; }
.${scope}.walk .shell { animation: ${scope}-sway .62s ease-in-out infinite; }
.${scope}.walk .leg-a { animation: ${scope}-step-a .62s ease-in-out infinite; }
.${scope}.walk .leg-b { animation: ${scope}-step-b .62s ease-in-out infinite; }
.${scope}.celebrate .shell { animation: ${scope}-jump .9s ease-in-out infinite; }
.${scope}.celebrate .spark { animation: ${scope}-spark 1.1s ease-out infinite; }
.${scope}.celebrate .spark-2 { animation-delay: .18s; }
.${scope}.celebrate .spark-3 { animation-delay: .36s; }
.${scope}.static, .${scope}.static * { animation: none !important; }
@media (prefers-reduced-motion: reduce) {
  .${scope}, .${scope} * { animation: none !important; }
}
@keyframes ${scope}-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2.5px); }
}
@keyframes ${scope}-sway {
  0%, 100% { transform: rotate(-2deg); }
  50% { transform: rotate(2deg); }
}
@keyframes ${scope}-step-a {
  0%, 100% { transform: rotate(12deg); }
  50% { transform: rotate(-12deg); }
}
@keyframes ${scope}-step-b {
  0%, 100% { transform: rotate(-12deg); }
  50% { transform: rotate(12deg); }
}
@keyframes ${scope}-jump {
  0%, 100% { transform: translateY(0); }
  35% { transform: translateY(-7px); }
  65% { transform: translateY(-2px); }
}
@keyframes ${scope}-spark {
  0% { opacity: 0; transform: scale(.4); }
  40% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(.7); }
}
`;

  return (
    <span
      className={classes}
      role="img"
      aria-label={label ?? LABELS[state]}
      data-aperture-ui="mascot"
      data-state={state}
      style={{ display: 'inline-block', width: size, height: size, lineHeight: 0, ...style }}
    >
      <style>{css}</style>
      <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true" focusable="false">
        <ellipse cx="32" cy="59" rx="14" ry="2.4" fill={color} opacity="0.14" />
        <g className="shell">
          <rect className="leg-a" x="25" y="43" width="5.5" height="11" rx="2.75" fill={color} opacity="0.8" />
          <rect className="leg-b" x="33.5" y="43" width="5.5" height="11" rx="2.75" fill={color} opacity="0.8" />
          <path
            d="M32 8c9.4 0 15 5.2 15 13.4v12.2C47 43 40.6 48.2 32 50.5 23.4 48.2 17 43 17 33.6V21.4C17 13.2 22.6 8 32 8Z"
            fill={color}
          />
          <path
            d="M32 8c9.4 0 15 5.2 15 13.4v12.2C47 43 40.6 48.2 32 50.5"
            stroke={accent}
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
            opacity="0.9"
          />
          <rect x="24" y="17" width="16" height="3.4" rx="1.7" fill="#0f172a" opacity="0.55" />
          <path d="M32 24l6 6-6 6-6-6 6-6Z" fill={accent} opacity="0.9" />
        </g>
        <g className="spark spark-1">
          <circle cx="13" cy="18" r="1.9" fill={accent} />
        </g>
        <g className="spark spark-2">
          <circle cx="51" cy="16" r="1.6" fill={accent} />
        </g>
        <g className="spark spark-3">
          <circle cx="50" cy="40" r="1.3" fill={accent} />
        </g>
      </svg>
    </span>
  );
}
