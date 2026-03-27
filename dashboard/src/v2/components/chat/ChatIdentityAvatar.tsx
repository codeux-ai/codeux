import type { FunctionComponent } from "preact";
import { useEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { UserCircle2, Sparkles, Bot, Blocks, Cpu, User } from "lucide-preact";
import { type ChatIdentityRole, getAvatarStyles } from "../../lib/chat-appearance.js";

interface ChatIdentityAvatarProps {
  role: ChatIdentityRole;
  className?: string;
  animate?: boolean;
}

const AnimatedJules: FunctionComponent = () => {
  const containerRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mediaQuery.matches) return;

    const ctx = gsap.context(() => {
      gsap.to(".j-dot", {
        y: -3,
        duration: 0.8,
        yoyo: true,
        repeat: -1,
        ease: "power1.inOut",
        stagger: 0.15,
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  return (
    <svg
      ref={containerRef}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M12 2v20M12 22c-3.5 0-6-2.5-6-6" />
      <circle cx="12" cy="6" r="1.5" className="j-dot fill-current" />
      <circle cx="12" cy="11" r="1.5" className="j-dot fill-current" />
      <circle cx="12" cy="16" r="1.5" className="j-dot fill-current" />
    </svg>
  );
};

const AnimatedBoat: FunctionComponent = () => {
  const containerRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mediaQuery.matches) return;

    const ctx = gsap.context(() => {
      gsap.to(".boat-hull", {
        y: -1,
        rotation: 2,
        duration: 2,
        yoyo: true,
        repeat: -1,
        ease: "sine.inOut",
      });
      gsap.to(".boat-sail", {
        rotation: 3,
        duration: 1.5,
        yoyo: true,
        repeat: -1,
        ease: "sine.inOut",
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  return (
    <svg
      ref={containerRef}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M4 17l2 4h12l2-4H4z" className="boat-hull" />
      <path d="M12 17V3l-5 7h5" className="boat-sail" />
    </svg>
  );
};

export const ChatIdentityAvatar: FunctionComponent<ChatIdentityAvatarProps> = ({
  role,
  className = "",
  animate = true,
}) => {
  const styles = getAvatarStyles(role);

  let Icon: any;
  if (role === "jules") {
    Icon = animate ? AnimatedJules : Sparkles;
  } else if (role === "virtual") {
    Icon = animate ? AnimatedBoat : Bot;
  } else if (role === "user") {
    Icon = UserCircle2;
  } else if (role === "worker") {
    Icon = Blocks;
  } else if (role === "agent") {
    Icon = Cpu;
  } else {
    Icon = User;
  }

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-[0.9rem] border ${styles.bgClass} ${styles.borderClass} ${styles.colorClass} ${className}`}
      aria-label={styles.label}
    >
      <Icon className="h-4 w-4" strokeWidth={1.6} />
    </div>
  );
};
