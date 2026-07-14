import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { PillChoiceGroup, SelectInput } from "../SettingsFormFields.js";
import { SectionCard, Row, getFieldBadge } from "./SharedPanelComponents.js";
import { Check, Image, Monitor } from "lucide-preact";
import { applyAppearanceSettings } from "../../../lib/apply-appearance.js";
import type { BackgroundPattern, DashboardAccentColor } from "../../../../types.js";
import { useThemeSetting } from "../../../hooks/useThemeSetting.js";
import { ACCENT_COLOR_PRESETS, getAccentColorPreset } from "../../../lib/accent-colors.js";
import { useDashboardI18n } from "../../../i18n/context.js";
import {
  settingsShellMessages,
  type SettingsShellMessageKey,
} from "../../../i18n/messages/settings-shell.js";

interface AccentPresetMessageKeys {
  label: SettingsShellMessageKey;
  description: SettingsShellMessageKey;
}

const ACCENT_PRESET_MESSAGE_KEYS = {
  CODEUX: { label: "accentCodeUx", description: "accentCodeUxDescription" },
  OCEAN: { label: "accentOcean", description: "accentOceanDescription" },
  VIOLET: { label: "accentViolet", description: "accentVioletDescription" },
  CYAN: { label: "accentCyan", description: "accentCyanDescription" },
  MAGENTA: { label: "accentMagenta", description: "accentMagentaDescription" },
  GRAPHITE: { label: "accentGraphite", description: "accentGraphiteDescription" },
} as const satisfies Readonly<Record<DashboardAccentColor, AccentPresetMessageKeys>>;

const ANIMATED_BACKGROUND_OPTIONS = [
  { value: "deep-ocean", label: "animatedBackgroundDeepOcean" },
  { value: "neon-dreams", label: "animatedBackgroundNeonDreams" },
  { value: "aurora-borealis", label: "animatedBackgroundAuroraBorealis" },
  { value: "cosmic-dust", label: "animatedBackgroundCosmicDust" },
  { value: "ethereal-mist", label: "animatedBackgroundEtherealMist" },
  { value: "quantum-field", label: "animatedBackgroundQuantumField" },
] as const satisfies ReadonlyArray<{
  value: string;
  label: SettingsShellMessageKey;
}>;

export const SettingsAppearancePanel: FunctionComponent<{
  state: SettingsPageState;
}> = ({ state }) => {
  const { locale, setLocale, translate } = useDashboardI18n();
  const [localeAnnouncement, setLocaleAnnouncement] = useState<string | null>(null);
  const settings = state.editableSettings;
  if (!settings) {
    return null;
  }

  const { activeScope, projectSources } = state;
  const appearance = settings.appearance;
  const { theme: persistedTheme, setTheme } = useThemeSetting();
  const [showSizeWarning, setShowSizeWarning] = useState(false);
  const supportsNativeZoom = typeof window !== "undefined" && Boolean(window.codeUxDesktop?.setZoom);
  const activeAccent = getAccentColorPreset(appearance.accentColor);
  const activeAccentLabel = translate(
    settingsShellMessages,
    ACCENT_PRESET_MESSAGE_KEYS[activeAccent.id].label,
  );

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <SectionCard
        sectionId="display-settings"
        title={translate(settingsShellMessages, "displaySettings")}
        watermark="UI"
        icon={<Monitor strokeWidth={2.4} />}
        accent="violet"
        highlights={[
          { label: translate(settingsShellMessages, "theme"), value: (activeScope === "system" ? persistedTheme : appearance.theme).toLowerCase(), tone: "active" },
          { label: translate(settingsShellMessages, "navigation"), value: appearance.navigationMode === "DOCK" ? translate(settingsShellMessages, "floatingDock") : translate(settingsShellMessages, "sidebar") },
          { label: translate(settingsShellMessages, "accent"), value: activeAccentLabel },
        ]}
      >
        <Row
          label={translate(settingsShellMessages, "navigationMode")}
          description={translate(settingsShellMessages, "navigationModeHelp")}
          badge={getFieldBadge(activeScope, projectSources, "appearance.navigationMode")}
        >
          <PillChoiceGroup
            value={appearance.navigationMode}
            onChange={(val) => {
              state.updateEditableSettings((current) => ({
                ...current,
                appearance: {
                  ...current.appearance,
                  navigationMode: val as "DOCK" | "SIDEBAR",
                },
              }));
            }}
            options={[
              { value: "DOCK", label: translate(settingsShellMessages, "dock") },
              { value: "SIDEBAR", label: translate(settingsShellMessages, "sidebar") },
            ]}
          />
        </Row>

        <Row
          label={translate(settingsShellMessages, "theme")}
          description={translate(settingsShellMessages, "themeHelp")}
          badge={getFieldBadge(activeScope, projectSources, "appearance.theme")}
        >
          <PillChoiceGroup
            value={activeScope === "system" ? persistedTheme : appearance.theme}
            onChange={(val) => {
              const newTheme = val as "LIGHT" | "DARK" | "SYSTEM";
              state.updateEditableSettings((current) => ({
                ...current,
                appearance: {
                  ...current.appearance,
                  theme: newTheme,
                },
              }));
              if (activeScope === "system") {
                setTheme(newTheme);
              }
              applyAppearanceSettings({ theme: newTheme });
            }}
            options={[
              { value: "LIGHT", label: translate(settingsShellMessages, "light") },
              { value: "DARK", label: translate(settingsShellMessages, "dark") },
              { value: "SYSTEM", label: translate(settingsShellMessages, "system") },
            ]}
          />
        </Row>

        <Row
          label={translate(settingsShellMessages, "language")}
          description={translate(settingsShellMessages, "languageHelp")}
        >
          <div className="flex min-w-0 flex-col gap-2">
            <PillChoiceGroup
              value={locale}
              onChange={(value) => {
                const nextLocale = value === "de" ? "de" : "en";
                setLocale(nextLocale);
                setLocaleAnnouncement(translate(
                  settingsShellMessages,
                  nextLocale === "de" ? "languageChangedGerman" : "languageChangedEnglish",
                ));
              }}
              aria-label={translate(settingsShellMessages, "languageChoices")}
              options={[
                { value: "en", label: translate(settingsShellMessages, "english") },
                { value: "de", label: translate(settingsShellMessages, "german") },
              ]}
            />
            <p className="max-w-xl text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
              {translate(settingsShellMessages, "languageScopeHelp")}
            </p>
            <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
              {localeAnnouncement}
            </span>
          </div>
        </Row>

        <Row
          label={translate(settingsShellMessages, "accentColor")}
          description={translate(settingsShellMessages, "accentColorHelp")}
          badge={getFieldBadge(activeScope, projectSources, "appearance.accentColor")}
        >
          <div role="radiogroup" aria-label={translate(settingsShellMessages, "accentColorLabel")} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ACCENT_COLOR_PRESETS.map((preset) => {
              const selected = preset.id === (appearance.accentColor || "CODEUX");
              const messageKeys = ACCENT_PRESET_MESSAGE_KEYS[preset.id];
              const presetLabel = translate(settingsShellMessages, messageKeys.label);
              const presetDescription = translate(settingsShellMessages, messageKeys.description);
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`${presetLabel}. ${presetDescription}`}
                  onClick={() => {
                    state.updateEditableSettings((current) => ({
                      ...current,
                      appearance: {
                        ...current.appearance,
                        accentColor: preset.id,
                      },
                    }));
                    applyAppearanceSettings({ accentColor: preset.id });
                  }}
                  className={`group relative min-h-20 rounded-xl border p-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-focus-ring)] ${
                    selected
                      ? "border-[color:var(--accent-action)] bg-[rgb(var(--accent-action-rgb)/0.08)] shadow-[0_0_0_1px_rgb(var(--accent-action-rgb)/0.12)]"
                      : "border-black/[0.08] bg-white/55 hover:border-black/[0.15] hover:bg-white/80 dark:border-white/[0.08] dark:bg-white/[0.035] dark:hover:border-white/[0.16] dark:hover:bg-white/[0.06]"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span aria-hidden="true" className="flex h-7 w-7 overflow-hidden rounded-full border border-black/10 shadow-sm dark:border-white/15">
                      <span className="h-full w-1/2" style={{ backgroundColor: preset.lightSwatch }} />
                      <span className="h-full w-1/2" style={{ backgroundColor: preset.darkSwatch }} />
                    </span>
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full transition ${selected ? "bg-[var(--accent-action)] text-[var(--accent-on-solid)]" : "border border-black/10 text-transparent dark:border-white/15"}`}>
                      <Check aria-hidden="true" className="h-3 w-3" strokeWidth={3} />
                    </span>
                  </span>
                  <span className="mt-2 block text-xs font-bold text-slate-800 dark:text-slate-100">{presetLabel}</span>
                </button>
              );
            })}
          </div>
        </Row>

        <Row
          label={translate(settingsShellMessages, "reducedMotion")}
          description={translate(settingsShellMessages, "reducedMotionHelp")}
          badge={getFieldBadge(activeScope, projectSources, "appearance.reducedMotion")}
          last={!supportsNativeZoom}
        >
          <PillChoiceGroup
            value={appearance.reducedMotion}
            onChange={(val) => {
              const newReducedMotion = val as "AUTO" | "REDUCE" | "NONE";
              state.updateEditableSettings((current) => ({
                ...current,
                appearance: {
                  ...current.appearance,
                  reducedMotion: newReducedMotion,
                },
              }));
              applyAppearanceSettings({ reducedMotion: newReducedMotion });
            }}
            options={[
              { value: "AUTO", label: translate(settingsShellMessages, "auto") },
              { value: "REDUCE", label: translate(settingsShellMessages, "reduce") },
              { value: "NONE", label: translate(settingsShellMessages, "noReduction") },
            ]}
          />
        </Row>

        {supportsNativeZoom && (
          <Row
            label={translate(settingsShellMessages, "zoomLevel")}
            description={translate(settingsShellMessages, "zoomLevelHelp")}
            badge={getFieldBadge(activeScope, projectSources, "appearance.zoomLevel")}
            last
          >
            <SelectInput
              value={String(appearance.zoomLevel ?? 1)}
              onChange={(val) => {
                const newZoom = Number(val);
                state.updateEditableSettings((current) => ({
                  ...current,
                  appearance: {
                    ...current.appearance,
                    zoomLevel: newZoom,
                  },
                }));
                applyAppearanceSettings({ zoomLevel: newZoom });
              }}
              options={[
                { value: "0.75", label: "75%" },
                { value: "0.9", label: "90%" },
                { value: "1", label: "100%" },
                { value: "1.1", label: "110%" },
                { value: "1.25", label: "125%" },
                { value: "1.5", label: "150%" },
                { value: "1.75", label: "175%" },
                { value: "2", label: "200%" },
                { value: "2.25", label: "225%" },
                { value: "2.5", label: "250%" },
              ]}
            />
          </Row>
        )}
      </SectionCard>

      <SectionCard
        title={translate(settingsShellMessages, "background")}
        watermark="BG"
        icon={<Image strokeWidth={2.4} />}
        accent="fuchsia"
        highlights={[
          { label: translate(settingsShellMessages, "mode"), value: appearance.backgroundMode === "STATIC" ? translate(settingsShellMessages, "static") : translate(settingsShellMessages, "animated"), tone: "active" },
          { label: translate(settingsShellMessages, "customImage"), value: appearance.backgroundImage ? translate(settingsShellMessages, "applied") : translate(settingsShellMessages, "none") },
          { label: translate(settingsShellMessages, "pattern"), value: appearance.backgroundPattern === "NONE" ? translate(settingsShellMessages, "none") : appearance.backgroundPattern || "Grid" },
        ]}
      >
        <Row
          label={translate(settingsShellMessages, "backgroundImage")}
          description={translate(settingsShellMessages, "backgroundImageHelp")}
          badge={getFieldBadge(activeScope, projectSources, "appearance.backgroundImage")}
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-4">
              {appearance.backgroundImage ? (
                <>
                  <img src={appearance.backgroundImage} alt={translate(settingsShellMessages, "backgroundThumbnail")} className="h-16 w-16 rounded-lg object-cover border border-black/10 dark:border-white/10" />
                  <button
                    type="button"
                    onClick={() => {
                      state.updateEditableSettings((current) => ({
                        ...current,
                        appearance: {
                          ...current.appearance,
                          backgroundImage: null,
                        },
                      }));
                      applyAppearanceSettings({ backgroundImage: null });
                    }}
                    className="rounded-lg px-3 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-void-800"
                  >
                    {translate(settingsShellMessages, "remove")}
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="file"
                    accept="image/*"
                    id="bg-image-input"
                    className="hidden"
                    onChange={(e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (!file) return;

                      setShowSizeWarning(file.size > 5 * 1024 * 1024);

                      const reader = new FileReader();
                      reader.onloadend = () => {
                        const result = reader.result as string;
                        state.updateEditableSettings((current) => ({
                          ...current,
                          appearance: {
                            ...current.appearance,
                            backgroundImage: result,
                          },
                        }));
                        applyAppearanceSettings({ backgroundImage: result });
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => document.getElementById('bg-image-input')?.click()}
                    className="rounded-lg border border-black/10 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-white/10 dark:bg-void-800 dark:text-slate-200 dark:hover:bg-void-700"
                  >
                    {translate(settingsShellMessages, "uploadImage")}
                  </button>
                </>
              )}
            </div>
            {showSizeWarning && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {translate(settingsShellMessages, "largeImageWarning")}
              </p>
            )}
          </div>
        </Row>

        <Row
          label={translate(settingsShellMessages, "backgroundMode")}
          description={translate(settingsShellMessages, "backgroundModeHelp")}
          badge={getFieldBadge(activeScope, projectSources, "appearance.backgroundMode")}
        >
          <PillChoiceGroup
            value={appearance.backgroundMode || "ANIMATED"}
            onChange={(val) => {
              state.updateEditableSettings((current) => ({
                ...current,
                appearance: {
                  ...current.appearance,
                  backgroundMode: val as "ANIMATED" | "STATIC",
                },
              }));
            }}
            options={[
              { value: "ANIMATED", label: translate(settingsShellMessages, "animated") },
              { value: "STATIC", label: translate(settingsShellMessages, "static") },
            ]}
          />
        </Row>

        {(appearance.backgroundMode || "ANIMATED") === "ANIMATED" ? (
          <Row
            label={translate(settingsShellMessages, "animationStyle")}
            description={translate(settingsShellMessages, "animationStyleHelp")}
            badge={getFieldBadge(activeScope, projectSources, "appearance.animatedBackground")}
          >
            <PillChoiceGroup
              value={appearance.animatedBackground || "deep-ocean"}
              onChange={(val) => {
                state.updateEditableSettings((current) => ({
                  ...current,
                  appearance: {
                    ...current.appearance,
                    animatedBackground: val,
                  },
                }));
              }}
              options={ANIMATED_BACKGROUND_OPTIONS.map((option) => ({
                value: option.value,
                label: translate(settingsShellMessages, option.label),
              }))}
            />
          </Row>
        ) : (
          <Row
            label={translate(settingsShellMessages, "staticColor")}
            description={translate(settingsShellMessages, "staticColorHelp")}
            badge={getFieldBadge(activeScope, projectSources, "appearance.staticBackgroundColor")}
          >
            <div className="flex items-center gap-3">
              <input
                type="color"
                aria-label={translate(settingsShellMessages, "staticColorLabel")}
                value={appearance.staticBackgroundColor || "#0d0f12"}
                onInput={(e) => {
                  state.updateEditableSettings((current) => ({
                    ...current,
                    appearance: {
                      ...current.appearance,
                      staticBackgroundColor: (e.target as HTMLInputElement).value,
                    },
                  }));
                }}
                className="h-10 w-20 cursor-pointer rounded-lg border-2 border-black/[0.06] bg-transparent p-1 focus:outline-none focus:ring-2 focus:ring-signal-500 dark:border-white/[0.06]"
              />
              <span className="font-mono text-sm uppercase text-slate-500 dark:text-slate-400">
                {appearance.staticBackgroundColor || "#0d0f12"}
              </span>
            </div>
          </Row>
        )}

        <Row
          label={translate(settingsShellMessages, "patternOverlay")}
          description={translate(settingsShellMessages, "patternOverlayHelp")}
          badge={getFieldBadge(activeScope, projectSources, "appearance.backgroundPattern")}
          last
        >
          <SelectInput
            value={appearance.backgroundPattern || "NONE"}
            onChange={(val) => {
              const newPattern = val as BackgroundPattern;
              state.updateEditableSettings((current) => ({
                ...current,
                appearance: {
                  ...current.appearance,
                  backgroundPattern: newPattern,
                },
              }));
              applyAppearanceSettings({ backgroundPattern: newPattern });
            }}
            options={[
              { value: "NONE", label: translate(settingsShellMessages, "none") },
              { value: "DIAGONAL_LINES", label: translate(settingsShellMessages, "diagonalLines") },
              { value: "HORIZONTAL_LINES", label: translate(settingsShellMessages, "horizontalLines") },
              { value: "VERTICAL_LINES", label: translate(settingsShellMessages, "verticalLines") },
              { value: "CROSSHATCH", label: translate(settingsShellMessages, "crosshatch") },
              { value: "DOTS", label: translate(settingsShellMessages, "dots") },
              { value: "DIAMONDS", label: translate(settingsShellMessages, "diamonds") },
              { value: "HEXAGONS", label: translate(settingsShellMessages, "hexagons") },
              { value: "TRIANGLES", label: translate(settingsShellMessages, "triangles") },
              { value: "WAVES", label: translate(settingsShellMessages, "waves") },
              { value: "NOISE", label: translate(settingsShellMessages, "noise") },
            ]}
          />
        </Row>
      </SectionCard>
    </div>
  );
};
