'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

export interface WatchPagerProps<T> {
  pages: readonly T[];
  renderPage: (page: T, index: number) => ReactNode;
  initialIndex?: number;
  /** Gap between slides in pixels; used for the scroll maths too. */
  gap?: number;
  showControls?: boolean;
  showDots?: boolean;
  ariaLabel?: string;
  onIndexChange?: (index: number) => void;
  className?: string;
  style?: CSSProperties;
  pageClassName?: string;
  pageStyle?: CSSProperties;
}

/**
 * WatchPager — a CSS scroll-snap pager.
 *
 * The browser does the scrolling and snapping; this component only keeps the
 * index in sync, wires the arrow keys and exposes dot/prev/next controls. No
 * measuring libraries, no resize observer.
 */
export function WatchPager<T>({
  pages,
  renderPage,
  initialIndex = 0,
  gap = 12,
  showControls = true,
  showDots = true,
  ariaLabel = 'Pager',
  onIndexChange,
  className,
  style,
  pageClassName,
  pageStyle,
}: WatchPagerProps<T>) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const total = pages.length;

  const clamp = useCallback(
    (value: number) => Math.min(Math.max(value, 0), Math.max(total - 1, 0)),
    [total],
  );

  const [index, setIndex] = useState(() => clamp(initialIndex));
  const indexRef = useRef(index);
  indexRef.current = index;

  const scrollTo = useCallback(
    (next: number, behavior: ScrollBehavior = 'smooth') => {
      const target = clamp(next);
      const viewport = viewportRef.current;
      if (viewport) {
        viewport.scrollTo({ left: target * (viewport.clientWidth + gap), behavior });
      }
      if (target !== indexRef.current) {
        indexRef.current = target;
        setIndex(target);
        onIndexChange?.(target);
      }
    },
    [clamp, gap, onIndexChange],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const onScroll = () => {
      const step = viewport.clientWidth + gap;
      if (step <= 0) {
        return;
      }
      const next = clamp(Math.round(viewport.scrollLeft / step));
      if (next !== indexRef.current) {
        indexRef.current = next;
        setIndex(next);
        onIndexChange?.(next);
      }
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', onScroll);
  }, [clamp, gap, onIndexChange]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        scrollTo(indexRef.current + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        scrollTo(indexRef.current - 1);
        break;
      case 'Home':
        event.preventDefault();
        scrollTo(0);
        break;
      case 'End':
        event.preventDefault();
        scrollTo(total - 1);
        break;
      default:
        break;
    }
  };

  if (total === 0) {
    return null;
  }

  return (
    <div className={className} style={style} data-aperture-ui="watch-pager" data-index={index}>
      <div
        ref={viewportRef}
        role="group"
        aria-roledescription="carousel"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={onKeyDown}
        style={{
          display: 'flex',
          gap,
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollSnapType: 'x mandatory',
          scrollBehavior: 'smooth',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'thin',
          outlineOffset: 2,
        }}
      >
        {pages.map((page, pageIndex) => (
          <div
            key={pageIndex}
            role="group"
            aria-roledescription="slide"
            aria-label={`${pageIndex + 1} of ${total}`}
            aria-hidden={pageIndex !== index}
            className={pageClassName}
            data-active={pageIndex === index}
            style={{
              flex: '0 0 100%',
              minWidth: 0,
              scrollSnapAlign: 'start',
              scrollSnapStop: 'always',
              ...pageStyle,
            }}
          >
            {renderPage(page, pageIndex)}
          </div>
        ))}
      </div>

      {total > 1 && (showControls || showDots) ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginTop: 8,
          }}
        >
          {showControls ? (
            <button
              type="button"
              onClick={() => scrollTo(index - 1)}
              disabled={index === 0}
              aria-label="Previous page"
              style={{ cursor: index === 0 ? 'default' : 'pointer', background: 'none', border: 'none', fontSize: 18, lineHeight: 1 }}
            >
              {'\u2039'}
            </button>
          ) : (
            <span />
          )}

          {showDots ? (
            <div role="tablist" aria-label={`${ariaLabel} pages`} style={{ display: 'flex', gap: 6 }}>
              {pages.map((_, dotIndex) => (
                <button
                  key={dotIndex}
                  type="button"
                  role="tab"
                  aria-selected={dotIndex === index}
                  aria-label={`Go to page ${dotIndex + 1}`}
                  onClick={() => scrollTo(dotIndex)}
                  style={{
                    width: 8,
                    height: 8,
                    padding: 0,
                    borderRadius: 999,
                    border: 'none',
                    cursor: 'pointer',
                    background:
                      dotIndex === index ? 'currentColor' : 'color-mix(in srgb, currentColor 30%, transparent)',
                  }}
                />
              ))}
            </div>
          ) : null}

          {showControls ? (
            <button
              type="button"
              onClick={() => scrollTo(index + 1)}
              disabled={index === total - 1}
              aria-label="Next page"
              style={{
                cursor: index === total - 1 ? 'default' : 'pointer',
                background: 'none',
                border: 'none',
                fontSize: 18,
                lineHeight: 1,
              }}
            >
              {'\u203a'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
