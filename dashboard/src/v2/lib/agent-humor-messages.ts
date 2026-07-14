export const STATUS_MESSAGE_MIN_INTERVAL_MS = 5_000;
export const STAGE_ACTIVITY_MESSAGE_MIN_INTERVAL_MS = 20_000;

export const AGENT_HUMOR_CATEGORIES = [
  "starting",
  "working",
  "delegating",
  "planning",
  "qa_handoff",
  "completion",
  "error",
  "thinking",
  "tool_exec",
  "tool_edit",
  "tool_read",
  "tool_search",
  "tool_web",
  "tool_generic",
  "mood",
] as const;

export type AgentHumorCategory = typeof AGENT_HUMOR_CATEGORIES[number];
export type AgentToolHumorCategory = Extract<AgentHumorCategory, `tool_${string}`>;

export interface AgentHumorCycle {
  index: number;
  startsAtMs: number;
  endsAtMs: number;
  durationMs: number;
}

export interface SelectAgentHumorMessageOptions {
  category: AgentHumorCategory | string;
  cycleDurationMs?: number;
  seed?: string | number | null;
  nowMs: number;
  locale?: DashboardLocale;
}

const CATEGORY_SET: ReadonlySet<string> = new Set(AGENT_HUMOR_CATEGORIES);

const buildMessages = (leads: readonly string[], finishes: readonly string[]): readonly string[] => (
  leads.flatMap((lead) => finishes.map((finish) => `${lead} ${finish}`))
);

export const AGENT_HUMOR_MESSAGES: Record<AgentHumorCategory, readonly string[]> = {
  starting: buildMessages(
    [
      "Opening the workspace",
      "Starting the planning kettle",
      "Warming up the sprint clipboard",
      "Booting the tiny status desk",
      "Rolling out the task runway",
      "Assembling the polite launch committee",
      "Unfolding the roadmap napkin",
      "Priming the keyboard espresso bar",
      "Checking the calendar confetti",
      "Lining up the commit parade",
    ],
    [
      "with a fresh marker and sensible shoes.",
      "before the sticky notes request a meeting.",
      "while the coffee negotiates scope.",
      "and giving the backlog a friendly nod.",
    ],
  ),
  working: buildMessages(
    [
      "Moving tickets through the spreadsheet spa",
      "Keeping the sprint train on its very tiny rails",
      "Turning requirements into neatly stacked pixels",
      "Polishing the task board until it reflects optimism",
      "Coaching the code through another professional stretch",
      "Stacking progress updates into a responsible little tower",
      "Convincing the backlog to use its indoor voice",
      "Making the diff look presentable for company",
      "Herding acceptance criteria into matching folders",
      "Keeping the implementation calendar hydrated",
    ],
    [
      "with coffee-level confidence.",
      "one well-labeled checkbox at a time.",
      "while the standup timer looks impressed.",
      "and reserving a conference room for the edge cases.",
    ],
  ),
  delegating: [
    "Delegating this with the confidence of a PM who just discovered the Assign button.",
    "I delegated the work and retained the vital responsibility of asking how it’s going.",
    "Sending this to a specialist so I can focus on moving its card to In Progress.",
    "The team is doing the work; I’m protecting them from a meeting about the work.",
    "I gave the task an owner, a deadline, and the emotional support of a colored label.",
    "This could have been a meeting, so I heroically made it someone else’s ticket.",
    "I’m not micromanaging; I’m refreshing the board with leadership intensity.",
    "An expert is handling it. I’ll convert the progress into a tastefully optimistic slide.",
    "We’re in the agency phase known as one tiny change with its own subproject.",
    "Scope creep arrived quietly and already has a desk, a login, and strong opinions.",
    "The deadline is fixed; reality has been asked to remain flexible.",
    "The client requested more premium. I assigned that measurable unit to the team.",
    "We skipped the pre-meeting about the meeting; productivity is at historic highs.",
    "The standup is seated today while the actual work stands up for itself.",
    "I’m circling back because going forward requires traditional PM choreography.",
    "Everyone is aligned, which is agency for the calendar invite was accepted.",
    "The brief says make it pop. Fortunately, our specialists are licensed in advanced popping.",
    "The logo asked to be bigger. We’re negotiating airspace.",
    "Version final-final-approved-3 has entered stakeholder review. Confidence is high-ish.",
    "The Gantt chart says this is fine, and charts are famously calm under pressure.",
    "I added a blocker to track the blocker blocking our blocker review.",
    "We’re agile enough to move the deadline and organized enough to call it a roadmap update.",
    "Resource allocation is complete: the busiest coworker has received the urgent task.",
    "Good news: the feedback is consolidated. Bad news: it consolidated into a rewrite.",
    "We have one source of truth and seven Slack threads discussing where it lives.",
    "The project is on track. We are currently defining track.",
    "I’m shielding the team from status requests with this tasteful status bubble.",
    "The estimate was two days before everyone spent three days estimating it.",
    "I assigned the action item and scheduled a follow-up to admire its journey.",
    "The sprint has a goal, a board, and a surprisingly ambitious social calendar.",
    "The agency triangle is intact: fast, good, cheap. Stakeholders selected all three.",
    "We reached consensus: everyone agrees someone else should approve it.",
    "I’m escalating this with the gentle urgency of a calendar invite marked Optional.",
    "The task is in expert hands; mine are busy holding the roadmap straight.",
    "I delegated decisively and will now contribute strategic nodding.",
    "I matched this task by skill, availability, and who had not muted me yet.",
    "I delegated this before it could become a recurring meeting.",
    "A coworker has the task; I have the confidence and none of the merge conflicts.",
    "I moved it to Doing, the ceremonial phase between Planning and Asking Again.",
    "Our action items now have action items. Governance is thriving.",
    "The brief is clear when read under the light of three follow-up calls.",
    "I asked for an ETA and received a thoughtful position on the nature of time.",
    "The creative review is booked; the creativity is finding an available slot.",
    "We’re waiting for final approval from the stakeholder who joined today.",
    "I converted uncertainty into a milestone. This is why they give me the clipboard.",
    "The task was delegated vertically, horizontally, and at least once accidentally.",
    "The project plan is current as of the meeting that changed the project plan.",
    "I protected the deadline by moving everything else.",
    "The ticket is perfectly groomed and emotionally unprepared for production.",
    "Today’s synergy is two coworkers independently avoiding the same meeting.",
    "I added buffer time; the calendar immediately ate it.",
    "The client said surprise me, followed by a detailed list of acceptable surprises.",
    "We’re brainstorming inside the approved brand weather system.",
    "This review round is final in the same way the file is final.",
    "I asked for blue-sky thinking under a low-ceiling budget.",
    "The dependency has a dependency; they’re starting a podcast.",
    "We’re doing async alignment, also known as reading the ticket.",
    "I reassigned the task to the person who said they could take a quick look.",
    "The meeting ended early. I’m filing it under operational miracles.",
    "I captured the feedback, tagged the owners, and released the carrier pigeons.",
    "The roadmap is directional, especially when the direction changes.",
    "Our bandwidth is full, but the request was marked quick, so physics approved it.",
    "I’m keeping stakeholders in the loop until the loop becomes a lasso.",
    "The coworker accepted the handoff. A tiny brass band is on standby.",
    "I made a RACI chart; four people now know exactly who should ask the fifth.",
    "The blocker is under review by the committee that formed around the blocker.",
    "This task is cross-functional: everyone can see it and nobody can close it.",
    "I scheduled focus time between two meetings about protecting focus time.",
    "The project is 90% done; the remaining 90% is stakeholder feedback.",
    "I distilled twelve comments into one clear direction: try both.",
    "Our single source of truth is currently out getting consensus.",
    "I asked for an owner; the room developed excellent eye contact with the floor.",
  ],
  planning: buildMessages(
    [
      "Mapping the work into sensible steps",
      "Giving the plan a careful first pass",
      "Lining up the dependencies",
      "Turning the goal into an execution map",
      "Checking the route before work begins",
    ],
    [
      "with the provider at the planning desk.",
      "while the scope stays in view.",
      "before the first task leaves the queue.",
      "and keeping every dependency explicit.",
    ],
  ),
  qa_handoff: buildMessages(
    [
      "Passing the current work to QA",
      "Putting the change under the review light",
      "Handing the evidence to the quality desk",
      "Checking the result against its criteria",
      "Giving the verification pass a clear runway",
    ],
    [
      "with the provider still on the record.",
      "while the checks read the fine print.",
      "before anyone calls the work finished.",
      "and keeping the verdict with the reviewer.",
    ],
  ),
  completion: buildMessages(
    [
      "Closing the recorded runtime step",
      "Putting a completed run in the ledger",
      "Marking the provider turn complete",
      "Finishing the known execution step",
      "Filing the completed activity",
    ],
    [
      "without adding claims beyond the record.",
      "with its result preserved in the transcript.",
      "while the next action remains undecided.",
      "and leaving the evidence easy to inspect.",
    ],
  ),
  error: buildMessages(
    [
      "Flagging a runtime problem",
      "Bringing the failed step into view",
      "Keeping the provider error visible",
      "Marking the execution issue clearly",
      "Stopping at the recorded failure",
    ],
    [
      "without guessing at the outcome.",
      "while the details remain available for review.",
      "before another action is attempted.",
      "and keeping the status unambiguous.",
    ],
  ),
  thinking: buildMessages(
    [
      "Asking the architecture diagram for its side of the story",
      "Letting the idea marinate in a clean build folder",
      "Running a quiet meeting with the tradeoffs",
      "Consulting the rubber duck advisory board",
      "Drafting a memo to future maintainers",
      "Sorting the assumptions by snack-table distance",
      "Looking for the path with the fewest surprise meetings",
      "Inviting the edge cases to a respectful roundtable",
      "Rehearsing the plan in a tiny whiteboard voice",
      "Comparing options with a very serious highlighter",
    ],
    [
      "before touching the keyboard.",
      "while the neurons file their status reports.",
      "and keeping the scope in a labeled drawer.",
      "so the next step has a decent agenda.",
    ],
  ),
  tool_exec: buildMessages(
    [
      "Sending a command down the terminal hallway",
      "Letting the shell do its little office workout",
      "Running the command with a clipboard nearby",
      "Pressing enter like a careful operations manager",
      "Giving the process a tidy launch badge",
      "Starting the terminal meeting on time",
      "Asking the command line for a crisp update",
      "Putting the script through its morning stretches",
      "Checking whether the prompt brought receipts",
      "Escorting the subprocess to its assigned desk",
    ],
    [
      "and waiting for the logs to finish their sentence.",
      "with the exit code on the agenda.",
      "while stdout clears its throat.",
      "and keeping stderr comfortably visible.",
    ],
  ),
  tool_edit: buildMessages(
    [
      "Sharpening the patch pencil",
      "Moving code furniture with felt pads",
      "Introducing the file to a modest improvement",
      "Editing with the change-control clipboard nearby",
      "Tucking the diff into a cleaner jacket",
      "Adjusting the implementation without alarming the tests",
      "Replacing the rough edge with a calmer one",
      "Giving the module a small ergonomic upgrade",
      "Writing the change like future-you is in the room",
      "Putting the patch on its best office lanyard",
    ],
    [
      "and keeping the footprint easy to review.",
      "while the formatting stays on speaking terms.",
      "with a respectful nod to surrounding patterns.",
      "so the next reader gets fewer mysteries.",
    ],
  ),
  tool_read: buildMessages(
    [
      "Reading the file like it has meeting notes",
      "Opening the source with a fresh cup of context",
      "Scanning the module for useful breadcrumbs",
      "Checking the implementation's desk drawers",
      "Letting the code explain itself first",
      "Reviewing the nearby types for clues",
      "Looking through the file cabinet labeled context",
      "Paging through the source with polite curiosity",
      "Inspecting the local pattern before making plans",
      "Taking attendance in the surrounding code",
    ],
    [
      "before the keyboard gets ambitious.",
      "with line numbers ready for the debrief.",
      "and noting where the real contract lives.",
      "while assumptions wait outside the room.",
    ],
  ),
  tool_search: buildMessages(
    [
      "Sending search through the codebase corridors",
      "Asking ripgrep to bring the good folders",
      "Looking for the symbol with a tiny detective notebook",
      "Checking every relevant corner of the repo map",
      "Following references like they left calendar invites",
      "Searching for patterns with measured optimism",
      "Inviting matching files to identify themselves",
      "Letting the index point at the useful shelves",
      "Tracking call sites with a polite magnifying glass",
      "Sorting search results by usefulness and desk snacks",
    ],
    [
      "before declaring anything obvious.",
      "while false positives make small talk.",
      "and keeping the scope filter tidy.",
      "so the next read starts in the right room.",
    ],
  ),
  tool_web: buildMessages(
    [
      "Checking the web with a travel-sized source checklist",
      "Opening the browser tab with professional curiosity",
      "Asking the internet for current paperwork",
      "Fetching the page while the citations line up",
      "Verifying the outside world did not rearrange the furniture",
      "Consulting the web before the facts get stale",
      "Pulling in the latest public context",
      "Letting the browser collect a few responsible receipts",
      "Looking online with the rumor filter engaged",
      "Checking the source before the summary joins the meeting",
    ],
    [
      "and keeping quotes on a short leash.",
      "with dates checked twice.",
      "while the links keep their badges visible.",
      "so the answer does not cosplay as yesterday.",
    ],
  ),
  tool_generic: buildMessages(
    [
      "Using the tool drawer with both labels facing out",
      "Handing the helper a neatly scoped request",
      "Letting the utility do its practical office magic",
      "Checking the tool output for sensible shoes",
      "Asking the helper to bring back useful receipts",
      "Giving the workflow a small mechanical advantage",
      "Opening the miscellaneous toolkit with supervision",
      "Running the helper through the normal paperwork",
      "Letting the automation carry one tray of details",
      "Inviting the tool to the status meeting briefly",
    ],
    [
      "and keeping the result easy to audit.",
      "while the inputs stay neatly labeled.",
      "with the success criteria in view.",
      "so the workflow keeps its rhythm.",
    ],
  ),
  mood: buildMessages(
    [
      "Feeling focused with a slightly theatrical clipboard",
      "Maintaining calm confidence in a sensible font",
      "Standing by with conference-room enthusiasm",
      "Radiating tidy progress vibes",
      "Keeping the avatar smile within operational limits",
      "Bringing organized optimism to the thread",
      "Holding a tiny ceremony for clear next steps",
      "Practicing relaxed readiness near the task board",
      "Wearing the good headset for important context",
      "Staying cheerful enough to label folders",
    ],
    [
      "and leaving room for real feedback.",
      "while the backlog behaves for now.",
      "with no unnecessary drama in the margins.",
      "so the conversation stays easy to steer.",
    ],
  ),
};

const buildGermanMessages = (
  activity: string,
  nouns: readonly string[],
): readonly string[] => buildMessages(
  nouns.map((noun) => `${activity} ${noun}`),
  [
    "mit ruhiger Zuversicht und klarer Beschriftung.",
    "während der Umfang freundlich im Blick bleibt.",
    "und hält die nächsten Schritte gut nachvollziehbar.",
    "ohne den belegten Laufzeitstand auszuschmücken.",
  ],
);

export const AGENT_HUMOR_MESSAGES_DE: Record<AgentHumorCategory, readonly string[]> = {
  starting: buildGermanMessages("Startet", ["den Arbeitsbereich", "den Planungsdesk", "die Sprint-Ablage", "den kleinen Statusschalter", "die Aufgabenrampe"]),
  working: buildGermanMessages("Bewegt", ["die Tickets durch den Ablauf", "den Sprint auf seiner Spur", "die Anforderungen Richtung Umsetzung", "das Task-Board zum nächsten Stand", "die Akzeptanzkriterien in passende Ordner"]),
  delegating: buildGermanMessages("Übergibt", ["die Aufgabe an einen Spezialisten", "die Umsetzung an das passende Teammitglied", "den nächsten Schritt an fachkundige Hände", "das Arbeitspaket mit klarer Zuständigkeit", "die Aufgabe samt Kontext und Ziel"]),
  planning: buildGermanMessages("Plant", ["die Arbeit in sinnvollen Schritten", "den ersten sorgfältigen Durchlauf", "die Abhängigkeiten in Reihenfolge", "den Weg vom Ziel zur Ausführung", "die Route vor dem Arbeitsbeginn"]),
  qa_handoff: buildGermanMessages("Übergibt", ["die aktuelle Arbeit an QA", "die Änderung an die Prüfung", "die Nachweise an den Qualitätsdesk", "das Ergebnis an seine Kriterien", "die Verifikation an den nächsten Durchlauf"]),
  completion: buildGermanMessages("Schließt", ["den aufgezeichneten Laufzeitschritt", "den abgeschlossenen Lauf im Protokoll", "den Anbieter-Durchgang", "den bekannten Ausführungsschritt", "die beendete Aktivität"]),
  error: buildGermanMessages("Markiert", ["ein Laufzeitproblem", "den fehlgeschlagenen Schritt", "den sichtbaren Anbieterfehler", "das Ausführungsproblem", "den aufgezeichneten Fehlschlag"]),
  thinking: buildGermanMessages("Prüft", ["die Sicht des Architekturdiagramms", "die Abwägungen in einer stillen Runde", "den Rat der Gummiente", "die Notiz für künftige Wartung", "den Weg mit den wenigsten Überraschungen"]),
  tool_exec: buildGermanMessages("Schickt", ["einen Befehl durch das Terminal", "die Shell in einen kurzen Arbeitslauf", "den Prozess an seinen Platz", "das Skript durch seinen Durchlauf", "die Kommandozeile zur Statusabfrage"]),
  tool_edit: buildGermanMessages("Bearbeitet", ["den Patch mit feinem Stift", "den Code mit vorsichtigen Schritten", "die Datei mit einer gezielten Verbesserung", "die Umsetzung entlang vorhandener Muster", "das Modul für den nächsten Leser"]),
  tool_read: buildGermanMessages("Liest", ["die Datei samt Besprechungsnotizen", "den Quelltext mit frischem Kontext", "das Modul nach hilfreichen Spuren", "die benachbarten Typen", "das lokale Muster vor der Planung"]),
  tool_search: buildGermanMessages("Durchsucht", ["die Korridore der Codebasis", "die passenden Ordner mit ripgrep", "die Referenzen zum Symbol", "die relevanten Ecken des Repositorys", "die Aufrufstellen mit einer kleinen Lupe"]),
  tool_web: buildGermanMessages("Prüft", ["das Web mit einer Quellenliste", "den Browser mit professioneller Neugier", "die aktuellen öffentlichen Angaben", "die Seite samt Datumsangaben", "die Quelle vor der Zusammenfassung"]),
  tool_generic: buildGermanMessages("Verwendet", ["die Werkzeugschublade mit sichtbaren Etiketten", "den Helfer für eine klar begrenzte Anfrage", "das Hilfsprogramm für praktische Details", "die Automatisierung für einen Arbeitsschritt", "das Werkzeug kurz in der Statusrunde"]),
  mood: buildGermanMessages("Bleibt", ["konzentriert mit einem leicht theatralischen Klemmbrett", "ruhig zuversichtlich in einer vernünftigen Schriftart", "mit Besprechungsraum-Begeisterung bereit", "bei geordnetem Optimismus", "fröhlich genug zum Beschriften von Ordnern"]),
};

export const getAgentHumorMessages = (
  category: AgentHumorCategory,
  locale: DashboardLocale = "en",
): readonly string[] => locale === "de" ? AGENT_HUMOR_MESSAGES_DE[category] : AGENT_HUMOR_MESSAGES[category];

export const isAgentHumorCategory = (category: string): category is AgentHumorCategory => (
  CATEGORY_SET.has(category)
);

const normalizeNowMs = (nowMs: number): number => (
  Number.isFinite(nowMs) ? Math.max(0, Math.floor(nowMs)) : 0
);

const hashString = (value: string): number => {
  let hash = 2_166_136_261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash >>> 0;
};

const normalizeSeed = (seed: SelectAgentHumorMessageOptions["seed"]): string => (
  seed === null || seed === undefined ? "" : String(seed)
);

const buildShuffledMessageDeck = (
  category: AgentHumorCategory,
  messages: readonly string[],
  seed: string,
  deckIndex: number,
): string[] => (
  [...messages].sort((left, right) => (
    hashString(`${category}|${seed}|deck:${deckIndex}|${left}`)
      - hashString(`${category}|${seed}|deck:${deckIndex}|${right}`)
    || left.localeCompare(right)
  ))
);

export const getAgentHumorCycle = (
  nowMs: number,
  cycleDurationMs = STATUS_MESSAGE_MIN_INTERVAL_MS,
): AgentHumorCycle => {
  const normalizedNowMs = normalizeNowMs(nowMs);
  const normalizedCycleDurationMs = Number.isFinite(cycleDurationMs)
    ? Math.max(1, Math.floor(cycleDurationMs))
    : STATUS_MESSAGE_MIN_INTERVAL_MS;
  const index = Math.floor(normalizedNowMs / normalizedCycleDurationMs);
  const startsAtMs = index * normalizedCycleDurationMs;
  return {
    index,
    startsAtMs,
    endsAtMs: startsAtMs + normalizedCycleDurationMs,
    durationMs: normalizedCycleDurationMs,
  };
};

export const selectAgentHumorMessage = ({
  category,
  cycleDurationMs,
  seed,
  nowMs,
  locale = "en",
}: SelectAgentHumorMessageOptions): string => {
  const resolvedCategory = isAgentHumorCategory(category) ? category : "tool_generic";
  const messages = getAgentHumorMessages(resolvedCategory, locale);
  const cycle = getAgentHumorCycle(nowMs, cycleDurationMs);
  const normalizedSeed = normalizeSeed(seed);
  const deckIndex = Math.floor(cycle.index / messages.length);
  const position = cycle.index % messages.length;
  const deck = buildShuffledMessageDeck(resolvedCategory, messages, normalizedSeed, deckIndex);
  if (deckIndex > 0) {
    const previousDeck = buildShuffledMessageDeck(resolvedCategory, messages, normalizedSeed, deckIndex - 1);
    if (deck[0] === previousDeck[previousDeck.length - 1]) {
      [deck[0], deck[1]] = [deck[1], deck[0]];
    }
  }
  return deck[position];
};

export const classifyToolHumorCategory = (toolName: string | null | undefined): AgentToolHumorCategory => {
  const normalized = typeof toolName === "string" ? toolName.trim().toLowerCase() : "";
  if (!normalized) {
    return "tool_generic";
  }
  if (/(web|fetch|browser|http|url|finance|weather|sports|image_query)/.test(normalized)) {
    return "tool_web";
  }
  if (/(exec|bash|shell|command|run|terminal|pty|spawn)/.test(normalized)) {
    return "tool_exec";
  }
  if (/(apply_patch|patch|edit|write|str_replace|create|update_file|replace)/.test(normalized)) {
    return "tool_edit";
  }
  if (/(grep|search|rg|glob|find|list|query)/.test(normalized)) {
    return "tool_search";
  }
  if (/(read|cat|view|open|file|sed|tail|head|nl|wc)/.test(normalized)) {
    return "tool_read";
  }
  return "tool_generic";
};
import type { DashboardLocale } from "../i18n/locales.js";
