import { h } from 'preact';
import { useRef, useEffect } from 'preact/hooks';
import { Link } from '@tanstack/react-router';
import { gsap } from 'gsap';
import { CanvasBackground } from './components/CanvasBackground.js';

interface ErrorPageProps {
  errorCode?: number;
  message?: string;
}

export function ErrorPage({ errorCode = 404, message = 'Page not found' }: ErrorPageProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      gsap.fromTo(
        contentRef.current,
        { opacity: 0, y: 32 },
        { opacity: 1, y: 0, duration: 0.6, ease: 'power4.out' }
      );
    }
  }, []);

  return (
    <div className="h-screen w-full flex items-center justify-center relative bg-transparent">
      <div className="absolute inset-0 z-0">
        <CanvasBackground />
      </div>
      <div ref={contentRef} className="z-10 flex flex-col items-center">
        <h1 className="text-[9rem] font-black leading-none bg-gradient-to-r from-[#00E0A0] to-[#FFB800] bg-clip-text text-transparent drop-shadow-[0_0_15px_rgba(0,224,160,0.3)]">
          {errorCode}
        </h1>
        <p className="text-xl text-slate-400 dark:text-slate-400 mt-4 mb-8">
          {message}
        </p>
        <Link
          to="/"
          className="bg-[#00E0A0] text-[#0d0f12] font-semibold px-6 py-3 rounded-[1.25rem] hover:opacity-90 transition-opacity"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
