import type { FunctionComponent } from "preact";
import { BriefcaseBusiness, Gamepad2, Globe2, Monitor, ShoppingCart } from "lucide-preact";
import type { DashboardCreateAppQuickactionKind } from "../../types.js";
import { CREATE_APP_QUICKACTION_CATALOG } from "../../../../../src/domain/chat/create-app-quickaction-catalog.js";
import { isInitialProjectCreateAppQuickaction } from "../../lib/cinematic-quick-actions.js";
import { useDashboardI18n } from "../../i18n/context.js";
import { chatMessages, type ChatTextMessageKey } from "../../i18n/messages/chat.js";

const CREATE_APP_ACTION_ICONS: Record<DashboardCreateAppQuickactionKind, typeof Monitor> = {
  web_app: Globe2,
  desktop_app: Monitor,
  online_shop: ShoppingCart,
  portfolio: BriefcaseBusiness,
  game: Gamepad2,
};

export const ChatCreateAppQuickActions: FunctionComponent<{
  disabled?: boolean;
  sending?: boolean;
  hasProject: boolean;
  showInitialCreateActions: boolean;
  onSelect: (kind: DashboardCreateAppQuickactionKind) => void;
}> = ({ disabled = false, sending = false, hasProject, showInitialCreateActions, onSelect }) => {
  const { locale, translate } = useDashboardI18n();
  const isDisabled = disabled || sending || !hasProject;
  const status = !hasProject
    ? translate(chatMessages, "createActionsNoProject")
    : sending
      ? translate(chatMessages, "createActionsSending")
      : translate(chatMessages, "createActionsAvailable");
  const labelKeys: Record<DashboardCreateAppQuickactionKind, ChatTextMessageKey> = {
    web_app: "createWebApp", desktop_app: "createDesktopApp", online_shop: "createOnlineShop", portfolio: "createPortfolio", game: "createGame",
  };
  const appKindLabelKeys: Record<DashboardCreateAppQuickactionKind, ChatTextMessageKey> = {
    web_app: "webApp", desktop_app: "desktopApp", online_shop: "onlineShop", portfolio: "portfolio", game: "game",
  };

  return (
    <div className="min-w-0" aria-label={translate(chatMessages, "createAppQuickActions")}>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
        {CREATE_APP_QUICKACTION_CATALOG.filter(({ kind }) => (
          showInitialCreateActions || !isInitialProjectCreateAppQuickaction(kind)
        )).map(({ kind, displayLabel, appKindLabel }) => {
          const Icon = CREATE_APP_ACTION_ICONS[kind];
          const label = locale === "en" ? displayLabel : translate(chatMessages, labelKeys[kind]);
          const localizedAppKindLabel = locale === "en"
            ? appKindLabel.toLowerCase()
            : translate(chatMessages, appKindLabelKeys[kind]);
          const description = translate(chatMessages, kind === "online_shop" ? "launchOnlineShopSprint" : "launchAppSprint", { appKind: localizedAppKindLabel });
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onSelect(kind)}
              disabled={isDisabled}
              aria-disabled={isDisabled}
              aria-label={label}
              aria-describedby={`create-app-quickaction-${kind}-description create-app-quickaction-status`}
              className={`group inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl border px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 sm:min-w-40 ${
                isDisabled
                  ? "cursor-not-allowed border-black/[0.06] bg-black/[0.035] text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-500"
                  : "border-signal-500/25 bg-signal-500/10 text-signal-700 hover:border-signal-500/45 hover:bg-signal-500/15 hover:text-signal-800 active:scale-[0.98] dark:text-signal-300 dark:hover:text-signal-200"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={2.2} aria-hidden="true" />
              <span className="min-w-0 whitespace-normal text-center leading-4">{label}</span>
              <span id={`create-app-quickaction-${kind}-description`} className="sr-only">
                {description}
              </span>
            </button>
          );
        })}
      </div>
      <div id="create-app-quickaction-status" role="status" aria-live="polite" className="sr-only">
        {status}
      </div>
    </div>
  );
};
