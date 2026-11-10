'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';

export interface MoneyRainProps {
  /** Running the burst. Toggle to false to stop and unmount immediately. */
  active?: boolean;
  /** How long the burst runs before the canvas unmounts itself. */
  durationMs?: number;
  /** Particle count. Defaults to exactly 64. */
  count?: number;
  /** Called once, after the canvas has stopped. */
  onComplete?: () => void;
  zIndex?: number;
  /** Skip the animation entirely when the OS asks for reduced motion. */
  respectReducedMotion?: boolean;
  className?: string;
  style?: CSSProperties;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  size: number;
  seed: number;
}

const DEFAULT_COUNT = 64;
const DEFAULT_DURATION_MS = 2600;
const GRAVITY = 0.045;

function createParticles(count: number, width: number, height: number): Particle[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: -Math.random() * height * 0.75 - 12,
    vx: (Math.random() - 0.5) * 0.9,
    vy: 0.9 + Math.random() * 1.5,
    rotation: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.09,
    size: 10 + Math.random() * 12,
    seed: Math.random() * 1000,
  }));
}

function drawBill(context: CanvasRenderingContext2D, particle: Particle): void {
  const width = particle.size;
  const height = particle.size * 0.55;

  context.save();
  context.translate(particle.x, particle.y);
  context.rotate(particle.rotation);

  context.fillStyle = '#1f9d55';
  context.strokeStyle = '#0f6b3a';
  context.lineWidth = 1;
  context.beginPath();
  if (typeof context.roundRect === 'function') {
    context.roundRect(-width / 2, -height / 2, width, height, 2.5);
  } else {
    context.rect(-width / 2, -height / 2, width, height);
  }
  context.fill();
  context.stroke();

  context.fillStyle = '#e9f7ef';
  context.font = `600 ${Math.max(7, width * 0.5)}px ui-sans-serif, system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('$', 0, 0.5);

  context.restore();
}

/**
 * MoneyRain — a Canvas 2D celebration overlay.
 *
 * 64 invoices by default, one `requestAnimationFrame` loop, no timers that
 * outlive the component. When the burst ends the canvas unmounts itself, so a
 * host app never keeps a full-screen layer or a frame loop alive.
 */
export function MoneyRain({
  active = true,
  durationMs = DEFAULT_DURATION_MS,
  count = DEFAULT_COUNT,
  onComplete,
  zIndex = 60,
  respectReducedMotion = true,
  className,
  style,
}: MoneyRainProps) {
  const [running, setRunning] = useState(active);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  useEffect(() => {
    setRunning(active);
  }, [active]);

  useEffect(() => {
    if (!running) {
      return;
    }

    if (
      respectReducedMotion &&
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setRunning(false);
      completeRef.current?.();
      return;
    }

    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      setRunning(false);
      completeRef.current?.();
      return;
    }

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;

    const resize = () => {
      width = canvas.clientWidth || window.innerWidth;
      height = canvas.clientHeight || window.innerHeight;
      canvas.width = Math.max(1, Math.floor(width * ratio));
      canvas.height = Math.max(1, Math.floor(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const particles = createParticles(Math.max(0, Math.floor(count)), width, height);
    const startedAt = performance.now();
    let finished = false;

    const stop = () => {
      if (finished) {
        return;
      }
      finished = true;
      setRunning(false);
      completeRef.current?.();
    };

    const frame = (now: number) => {
      context.clearRect(0, 0, width, height);

      for (const particle of particles) {
        particle.vy += GRAVITY;
        particle.x += particle.vx + Math.sin((now + particle.seed) / 320) * 0.5;
        particle.y += particle.vy;
        particle.rotation += particle.spin;
        drawBill(context, particle);
      }

      if (now - startedAt >= durationMs) {
        stop();
        return;
      }
      frameRef.current = requestAnimationFrame(frame);
    };

    const frameRef = { current: requestAnimationFrame(frame) };

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [running, count, durationMs, respectReducedMotion]);

  if (!running) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-aperture-ui="money-rain"
      className={className}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex,
        ...style,
      }}
    />
  );
}
