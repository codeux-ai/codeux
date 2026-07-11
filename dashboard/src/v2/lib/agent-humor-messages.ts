export const STATUS_MESSAGE_MIN_INTERVAL_MS = 5_000;

export const AGENT_HUMOR_CATEGORIES = [
  "starting",
  "working",
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
  durationMs: typeof STATUS_MESSAGE_MIN_INTERVAL_MS;
}

export interface SelectAgentHumorMessageOptions {
  category: AgentHumorCategory | string;
  seed?: string | number | null;
  nowMs: number;
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

export const getAgentHumorCycle = (nowMs: number): AgentHumorCycle => {
  const normalizedNowMs = normalizeNowMs(nowMs);
  const index = Math.floor(normalizedNowMs / STATUS_MESSAGE_MIN_INTERVAL_MS);
  const startsAtMs = index * STATUS_MESSAGE_MIN_INTERVAL_MS;
  return {
    index,
    startsAtMs,
    endsAtMs: startsAtMs + STATUS_MESSAGE_MIN_INTERVAL_MS,
    durationMs: STATUS_MESSAGE_MIN_INTERVAL_MS,
  };
};

export const selectAgentHumorMessage = ({
  category,
  seed,
  nowMs,
}: SelectAgentHumorMessageOptions): string => {
  const resolvedCategory = isAgentHumorCategory(category) ? category : "tool_generic";
  const messages = AGENT_HUMOR_MESSAGES[resolvedCategory];
  const cycle = getAgentHumorCycle(nowMs);
  const hash = hashString(`${resolvedCategory}|${normalizeSeed(seed)}|${cycle.index}`);
  return messages[hash % messages.length];
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
