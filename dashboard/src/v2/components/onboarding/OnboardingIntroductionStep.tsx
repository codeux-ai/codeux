import type { FunctionComponent } from "preact";
import { ShieldCheck, Info, Library, Github, Star, BookOpen } from "lucide-preact";
import { getSafeUrl } from "../../lib/safe-url.js";

const CODEUX_REPO_URL = "https://github.com/codeux-ai/codeux";

export interface OnboardingIntroductionStepProps {}

export const OnboardingIntroductionStep: FunctionComponent<OnboardingIntroductionStepProps> = () => {
  return (
    <div className="space-y-4">
      <div data-onboarding-card className="relative overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/80 p-6 shadow-[0_18px_48px_rgba(15,23,42,0.055)] dark:border-white/[0.06] dark:bg-white/[0.045]">
        <div aria-hidden className="absolute -right-8 -top-10 font-display text-[7rem] font-black leading-none tracking-tight text-black/[0.025] dark:text-white/[0.025]">UX</div>
        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-signal-700 dark:text-signal-200">
            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2.5} />
            <span>Local AI Orchestration</span>
          </div>

          <h4 className="mt-4 font-display text-3xl font-black leading-none tracking-tight text-slate-950 dark:text-white">Welcome to Code UX.</h4>
          <p className="mt-3 text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300">
            Code UX is an advanced containerized agentic workspace for turning projects into guided sprints, executable tasks, live previews, and measurable delivery. It coordinates provider CLIs inside isolated Docker runtimes, keeps credentials inside the intended tools, and gives you one polished control surface for agents, memory, knowledge base, browser sessions, and automation.
          </p>

        </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {[
          [Github, "GitHub", CODEUX_REPO_URL],
          [Star, "Star on GitHub", CODEUX_REPO_URL],
          [BookOpen, "Documentation", `${CODEUX_REPO_URL}#readme`],
        ].map(([Icon, label, href]) => {
          const BadgeIcon = Icon as any;
          return (
            <a
              key={String(label)}
              href={getSafeUrl(String(href))}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-2xl border border-black/[0.06] bg-white/80 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-slate-600 shadow-[0_10px_24px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:border-signal-500/25 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 dark:border-white/[0.08] dark:bg-white/[0.055] dark:text-slate-300 dark:hover:text-white"
            >
              {BadgeIcon({ className: "h-3.5 w-3.5 text-signal-600 dark:text-signal-300", strokeWidth: 2.4 })}
              {String(label)}
            </a>
          );
        })}
      </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[
          ["Container-first execution", "Provider CLIs run inside isolated Docker containers with a mounted workspace snapshot.", ShieldCheck],
          ["Credential boundary", "Local credentials are copied only into the intended CLI runtime and are not used as raw application secrets.", ShieldCheck],
          ["TOS-compliant workflow", "Authentication stays with each provider's supported CLI flow, so Code UX orchestrates tools instead of impersonating providers.", ShieldCheck],
          ["Knowledge Base", "Maintain a persistent technical knowledge base that agents use for deep architectural context.", Library],
        ].map(([title, description, CardIcon]) => {
          return (
            <div data-onboarding-card key={title as string} className="group rounded-3xl border border-black/[0.06] bg-white/75 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.045)] transition-transform hover:-translate-y-1 dark:border-white/[0.06] dark:bg-white/[0.04]">

              {(CardIcon as any)({ className: "h-6 w-6 text-signal-600 dark:text-signal-300" })}
              <div className="mt-4 text-base font-black text-slate-900 dark:text-white">{title as string}</div>
              <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{description as string}</div>
            </div>
          );
        })}
      </div>
      <div data-onboarding-card className="relative overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/80 p-6 shadow-[0_18px_48px_rgba(15,23,42,0.055)] dark:border-white/[0.06] dark:bg-white/[0.045]">
        <div aria-hidden className="absolute -right-8 -top-10 font-display text-[7rem] font-black leading-none tracking-tight text-black/[0.025] dark:text-white/[0.025]">MIT</div>
        <div className="relative z-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-signal-600 dark:text-signal-300" strokeWidth={2.4} />
              <div className="text-sm font-black uppercase tracking-[0.16em] text-slate-700 dark:text-slate-200">License</div>
            </div>
            <a
              href={getSafeUrl(`${CODEUX_REPO_URL}/blob/main/LICENSE`)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold text-signal-600 hover:underline dark:text-signal-400"
            >
              View full license
            </a>
          </div>
          <div className="mt-4 max-h-48 overflow-y-auto rounded-2xl border border-black/[0.06] bg-white/50 p-4 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-black/20 dark:text-slate-400">
            <pre className="whitespace-pre-wrap font-sans">
              {`MIT License\n\nCopyright (c) 2026 Pierre Voss\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};