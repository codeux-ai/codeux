import { type FunctionComponent } from "preact";
import { useRef, useEffect, useState } from "preact/hooks";
import gsap from "gsap";
import { Check, CheckCheck, XCircle, Loader2 } from "lucide-preact";
import type { ChatMessageRecord, AgentAvatarConfig } from "../../types.js";
import { renderMarkdown } from "../../../lib/markdown.js";
import { getChatWidgetData } from "../../lib/chat-widget-view-models.js";
import { formatChatTime } from "../../lib/chat-time.js";
import { PlanningRequestWidget } from "./widgets/PlanningRequestWidget.js";
import { ChatAvatar, type AvatarRole } from "./ChatAvatar.js";
import { resolveDisplayDeliveryStatus } from "../../hooks/use-chat-thread-data.js";

export interface ChatMessageBubbleProps {
  message: ChatMessageRecord;
  allMessages?: ChatMessageRecord[];
  agentAvatarConfig?: AgentAvatarConfig;
  agentName?: string;
}

export const ChatMessageBubble: FunctionComponent<ChatMessageBubbleProps> = ({
  message,
  allMessages = [],
  agentAvatarConfig,
  agentName,
}) => {
  const fromDashboard = message.direction === "dashboard_to_connection";
  const widgetData = getChatWidgetData(message);

  let role: AvatarRole = "agent";
  if (fromDashboard) {
    role = "user";
  } else if (message.authorType === "system") {
    role = "system";
  } else if (message.metadata?.provider === "jules" || message.authorType === "connection") {
    role = agentAvatarConfig ? "agent" : "jules";
  }

  const senderName = fromDashboard
    ? "User"
    : agentName || (message.metadata?.agentName as string) || "Assistant";
  const providerLabel = message.metadata?.provider as string | undefined;
  const createdAtLabel = formatChatTime(message.createdAt);

  const displayDeliveryStatus = resolveDisplayDeliveryStatus(message, allMessages);
  const foundIndex = allMessages.findIndex((m) => m.id === message.id);

  const bubbleRef = useRef<HTMLDivElement>(null);
  const [initialDelay] = useState(() => {
    const recentIndex = allMessages.length - foundIndex;
    return recentIndex <= 5 ? (5 - recentIndex) * 0.08 : 0;
  });

  useEffect(() => {
    if (!bubbleRef.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(bubbleRef.current,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.3, delay: initialDelay, ease: "power2.out" }
      );
    });
    return () => ctx.revert();
  }, [initialDelay]);

  useEffect(() => {
    if (!bubbleRef.current) return;
    const preElements = bubbleRef.current.querySelectorAll("pre");
    if (!preElements.length) return;

    const cleanupFns: Array<() => void> = [];

    preElements.forEach((pre) => {
      // Check if already wrapped
      if (pre.parentElement?.classList.contains("code-block-wrapper")) return;

      const wrapper = document.createElement("div");
      wrapper.className = "code-block-wrapper rounded-md border border-white/10 bg-black/30 my-4 overflow-hidden";

      // Wrap the pre element
      if (pre.parentNode) {
        pre.parentNode.insertBefore(wrapper, pre);
      }
      wrapper.appendChild(pre);

      const header = document.createElement("div");
      header.className = "flex items-center justify-between px-3 py-2 bg-white/5 border-b border-white/5 text-xs text-slate-400 font-mono";

      const codeElement = pre.querySelector("code");
      const languageClass = codeElement?.className.match(/language-(\w+)/)?.[1] || "text";

      const langLabel = document.createElement("span");
      langLabel.textContent = languageClass;

      const actions = document.createElement("div");
      actions.className = "flex items-center gap-2";

      const copyBtn = document.createElement("button");
      copyBtn.className = "flex items-center gap-1.5 hover:text-slate-200 transition-colors code-copy-btn";
      copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><span>Copy</span>`;

      const toggleBtn = document.createElement("button");
      toggleBtn.className = "flex items-center hover:text-slate-200 transition-colors code-toggle-btn";
      toggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-up"><path d="m18 15-6-6-6 6"/></svg>`;

      actions.appendChild(copyBtn);
      actions.appendChild(toggleBtn);
      header.appendChild(langLabel);
      header.appendChild(actions);

      wrapper.insertBefore(header, pre);

      const onCopyClick = () => {
        if (!codeElement) return;
        const text = codeElement.innerText;
        navigator.clipboard.writeText(text).then(() => {
          const badge = document.createElement("span");
          badge.className = "text-signal-400 absolute right-full mr-2";
          badge.textContent = "Copied!";
          copyBtn.style.position = "relative";
          copyBtn.appendChild(badge);
          gsap.to(badge, { opacity: 0, duration: 0.3, delay: 1.5, onComplete: () => {
            badge.remove();
          }});
        });
      };
      copyBtn.addEventListener("click", onCopyClick);

      let isCollapsed = false;
      let originalHeight = 0;

      const onToggleClick = () => {
        if (!originalHeight) {
          originalHeight = pre.scrollHeight;
        }

        isCollapsed = !isCollapsed;

        if (isCollapsed) {
          pre.style.overflow = "hidden";
          gsap.fromTo(pre,
            { maxHeight: originalHeight, opacity: 1 },
            { maxHeight: 0, opacity: 0, duration: 0.3, ease: "power2.inOut" }
          );
          toggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down"><path d="m6 9 6 6 6-6"/></svg>`;
        } else {
          gsap.fromTo(pre,
            { maxHeight: 0, opacity: 0 },
            {
              maxHeight: originalHeight,
              opacity: 1,
              duration: 0.3,
              ease: "power2.inOut",
              onComplete: () => {
                pre.style.overflow = "auto";
                pre.style.maxHeight = "none";
              }
            }
          );
          toggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-up"><path d="m18 15-6-6-6 6"/></svg>`;
        }
      };
      toggleBtn.addEventListener("click", onToggleClick);

      cleanupFns.push(() => {
        copyBtn.removeEventListener("click", onCopyClick);
        toggleBtn.removeEventListener("click", onToggleClick);
      });

      // Adjust pre styles for embedding
      pre.style.margin = "0";
      pre.style.borderRadius = "0";
      pre.style.border = "none";
      pre.style.background = "transparent";
      pre.style.padding = "1rem";
    });

    return () => {
      cleanupFns.forEach(fn => fn());
    };
  }, [message.bodyMarkdown]);

  const opacityClass = (fromDashboard && (displayDeliveryStatus === "pending" || displayDeliveryStatus === "failed"))
    ? "opacity-60"
    : "opacity-100";

  return (
    <div ref={bubbleRef} role="listitem" className={`flex ${fromDashboard ? "justify-end" : "justify-start"} ${opacityClass}`}>
      <div className={`flex max-w-[760px] items-start gap-3 w-full ${fromDashboard ? "flex-row-reverse" : "flex-row"}`}>
        <div className="mt-1 shrink-0 w-8 h-8 flex items-center justify-center">
          <ChatAvatar
            role={role}
            provider={providerLabel}
            agentName={!fromDashboard ? agentName || senderName : undefined}
            avatarConfig={!fromDashboard ? agentAvatarConfig : undefined}
          />
        </div>

        <div className={`flex flex-col w-full max-w-[calc(100%-3rem)] rounded-2xl border bg-white/5 backdrop-blur-md p-4 shadow-[0_2px_16px_rgba(0,0,0,0.04)] ${
          fromDashboard
            ? "rounded-tr-sm border-signal-500/20"
            : "rounded-tl-sm border-white/10"
        }`}>
          {/* Header Row */}
          <div className={`flex items-center gap-3 mb-2 text-[11px] font-mono text-slate-400 ${fromDashboard ? "justify-end flex-row-reverse" : "justify-start"}`}>
            <span className="font-semibold text-slate-300">{senderName}</span>
            {providerLabel && (
              <span className="px-1.5 py-0.5 rounded-sm bg-black/20 text-slate-300">
                {providerLabel}
              </span>
            )}
            {createdAtLabel && <span>{createdAtLabel}</span>}
          </div>

          {/* Message Body */}
          <div className="prose prose-sm max-w-none text-[14px] leading-7 text-slate-200 prose-headings:text-inherit prose-p:text-inherit prose-strong:text-inherit prose-code:text-inherit break-words"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.bodyMarkdown) }}
          />

          {/* Widget Slot */}
          {widgetData.type === "planning" && (
            <div className="mt-4 border-t border-white/5 pt-4">
              <PlanningRequestWidget status={widgetData.status} planName={widgetData.planName} />
            </div>
          )}

          {fromDashboard && (
             <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] font-mono">
               {displayDeliveryStatus === "pending" && (
                 <>
                   <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
                   <span className="text-slate-400">Queued</span>
                 </>
               )}
               {displayDeliveryStatus === "delivered" && (
                 <>
                   <Check className="h-3 w-3 text-slate-400" />
                   <span className="text-slate-400">Delivered</span>
                 </>
               )}
               {displayDeliveryStatus === "processed" && (
                 <>
                   <CheckCheck className="h-3 w-3 text-signal-500" />
                   <span className="text-signal-500">Processed</span>
                 </>
               )}
               {displayDeliveryStatus === "failed" && (
                 <>
                   <XCircle className="h-3 w-3 text-status-red" />
                   <span className="text-status-red">Failed</span>
                 </>
               )}
             </div>
          )}
        </div>
      </div>
    </div>
  );
};
