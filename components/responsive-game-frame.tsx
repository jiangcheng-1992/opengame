"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ResponsiveGameFrameProps = {
  title: string;
  src: string;
  shellClassName: string;
  iframeClassName?: string;
  allow?: string;
  sandbox?: string;
  fallbackWidth?: number;
  fallbackHeight?: number;
};

type FrameSize = {
  width: number;
  height: number;
};

const MIN_FRAME_WIDTH = 640;
const MIN_FRAME_HEIGHT = 360;
const MAX_FRAME_WIDTH = 2560;
const MAX_FRAME_HEIGHT = 2560;

function clampDimension(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function sameSize(a: FrameSize, b: FrameSize) {
  return Math.abs(a.width - b.width) < 4 && Math.abs(a.height - b.height) < 4;
}

function measureFrameSize(iframe: HTMLIFrameElement, fallback: FrameSize): FrameSize {
  try {
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    const root = doc?.documentElement;
    const body = doc?.body;
    if (!win || !doc || !root) return fallback;

    const bodyRect = body?.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const width = Math.max(
      win.innerWidth,
      root.clientWidth,
      root.scrollWidth,
      root.offsetWidth,
      body?.clientWidth ?? 0,
      body?.scrollWidth ?? 0,
      body?.offsetWidth ?? 0,
      Math.round(rootRect.width),
      Math.round(bodyRect?.width ?? 0),
    );
    const height = Math.max(
      win.innerHeight,
      root.clientHeight,
      root.scrollHeight,
      root.offsetHeight,
      body?.clientHeight ?? 0,
      body?.scrollHeight ?? 0,
      body?.offsetHeight ?? 0,
      Math.round(rootRect.height),
      Math.round(bodyRect?.height ?? 0),
    );

    return {
      width: clampDimension(width, fallback.width, MIN_FRAME_WIDTH, MAX_FRAME_WIDTH),
      height: clampDimension(height, fallback.height, MIN_FRAME_HEIGHT, MAX_FRAME_HEIGHT),
    };
  } catch {
    return fallback;
  }
}

export function ResponsiveGameFrame({
  title,
  src,
  shellClassName,
  iframeClassName,
  allow = "autoplay; fullscreen; gamepad",
  sandbox = "allow-scripts allow-same-origin allow-pointer-lock",
  fallbackWidth = 1280,
  fallbackHeight = 800,
}: ResponsiveGameFrameProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const fallbackSizeRef = useRef<FrameSize>({ width: fallbackWidth, height: fallbackHeight });
  const [frameSize, setFrameSize] = useState<FrameSize>(fallbackSizeRef.current);
  const [frameScale, setFrameScale] = useState(1);

  const updateFit = useCallback(() => {
    const shell = shellRef.current;
    const iframe = iframeRef.current;
    if (!shell || !iframe) return;

    const nextSize = measureFrameSize(iframe, fallbackSizeRef.current);
    const rect = shell.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const nextScale = Math.min(rect.width / nextSize.width, rect.height / nextSize.height, 1);
    setFrameSize((current) => (sameSize(current, nextSize) ? current : nextSize));
    setFrameScale((current) => (Math.abs(current - nextScale) < 0.01 ? current : nextScale));
  }, []);

  const attachFrameObservers = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;

    const iframe = iframeRef.current;
    if (!iframe) return;

    const cleanups: Array<() => void> = [];

    try {
      const win = iframe.contentWindow;
      const doc = iframe.contentDocument;
      const target = doc?.body ?? doc?.documentElement ?? null;
      if (win && target) {
        const resizeObserver = new ResizeObserver(() => requestAnimationFrame(updateFit));
        resizeObserver.observe(target);
        if (doc?.documentElement && doc.documentElement !== target) resizeObserver.observe(doc.documentElement);
        cleanups.push(() => resizeObserver.disconnect());

        const mutationObserver = new MutationObserver(() => requestAnimationFrame(updateFit));
        mutationObserver.observe(target, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
        cleanups.push(() => mutationObserver.disconnect());

        win.addEventListener("resize", updateFit);
        cleanups.push(() => win.removeEventListener("resize", updateFit));
      }
    } catch {
      // Same-origin access should normally work here, but keep a fallback path.
    }

    const intervalId = window.setInterval(updateFit, 1200);
    cleanups.push(() => window.clearInterval(intervalId));
    cleanupRef.current = () => cleanups.forEach((cleanup) => cleanup());

    updateFit();
  }, [updateFit]);

  useEffect(() => {
    fallbackSizeRef.current = { width: fallbackWidth, height: fallbackHeight };
    setFrameSize(fallbackSizeRef.current);
    setFrameScale(1);
  }, [fallbackHeight, fallbackWidth, src]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const resizeObserver = new ResizeObserver(() => requestAnimationFrame(updateFit));
    resizeObserver.observe(shell);
    return () => resizeObserver.disconnect();
  }, [updateFit]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      attachFrameObservers();
      updateFit();
    };

    iframe.addEventListener("load", handleLoad);
    const readyState = iframe.contentDocument?.readyState;
    if (readyState === "complete" || readyState === "interactive") handleLoad();

    return () => {
      iframe.removeEventListener("load", handleLoad);
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [attachFrameObservers, updateFit, src]);

  return (
    <div ref={shellRef} className={shellClassName}>
      <iframe
        ref={iframeRef}
        title={title}
        src={src}
        sandbox={sandbox}
        allow={allow}
        className={iframeClassName ?? "responsive-game-iframe"}
        style={{
          width: frameSize.width,
          height: frameSize.height,
          transform: `translate(-50%, -50%) scale(${frameScale})`,
        }}
      />
    </div>
  );
}
