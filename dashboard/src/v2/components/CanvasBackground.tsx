import type { FunctionComponent } from "preact";
import { useEffect, useRef } from "preact/hooks";
import gsap from "gsap";

export const CanvasBackground: FunctionComponent = () => {
    const splineRef = useRef<SVGPathElement>(null);

    useEffect(() => {
        if (splineRef.current) {
            const tl = gsap.timeline({ repeat: -1, yoyo: true });
            tl.to(splineRef.current, {
                attr: { d: "M 0,200 C 200,600 400,-100 800,400 C 1200,900 1600,0 2000,300" },
                duration: 16,
                ease: "sine.inOut"
            }).to(splineRef.current, {
                attr: { d: "M 0,400 C 300,-100 500,800 1000,200 C 1400,-200 1800,700 2000,500" },
                duration: 22,
                ease: "sine.inOut"
            });
            return () => {
                tl.kill();
            };
        }
    }, []);

    return (
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
            {/* Warm ambient gradients replacing the cold indigo splash */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_-10%_-10%,_rgba(0,224,160,0.04)_0%,_transparent_60%)] dark:bg-[radial-gradient(ellipse_80%_50%_at_-10%_-10%,_rgba(0,224,160,0.06)_0%,_transparent_60%)] transition-colors duration-1000" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_110%_110%,_rgba(255,184,0,0.03)_0%,_transparent_60%)] dark:bg-[radial-gradient(ellipse_50%_40%_at_110%_110%,_rgba(255,184,0,0.04)_0%,_transparent_60%)]" />

            {/* Signal → Ember flowing SVG line */}
            <svg className="absolute w-full h-[100vh] top-[5%] left-0 opacity-[0.025] dark:opacity-[0.04]" viewBox="0 0 2000 800" preserveAspectRatio="none">
                <path
                    ref={splineRef}
                    d="M 0,300 C 300,100 600,700 1000,300 C 1400,-100 1800,600 2000,200"
                    fill="none"
                    stroke="url(#bg-gradient)"
                    strokeWidth="2"
                />
                <defs>
                    <linearGradient id="bg-gradient" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#00E0A0" />
                        <stop offset="50%" stopColor="#33FFB8" />
                        <stop offset="100%" stopColor="#FFB800" />
                    </linearGradient>
                </defs>
            </svg>
        </div>
    );
};
