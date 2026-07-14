/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { render as testingRender, screen, fireEvent, cleanup, waitFor } from "@testing-library/preact";
import type { ComponentChildren } from "preact";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { AddProjectModal } from "../../../dashboard/src/v2/components/ui/AddProjectModal.js";
import { fetchLocalDirectories } from "../../../dashboard/src/v2/lib/project-api.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/context.js";
import type { DashboardLocale } from "../../../dashboard/src/v2/i18n/locales.js";

expect.extend(matchers);

const render = (children: ComponentChildren, locale: DashboardLocale = "en") => testingRender(
  <DashboardI18nProvider initialLocale={locale} storage={null}>{children}</DashboardI18nProvider>,
);

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    set: vi.fn(),
    context: (fn: () => void) => {
      fn();
      return { revert: vi.fn() };
    },
    to: vi.fn((_target, options) => {
      options?.onComplete?.();
    }),
  },
}));

vi.mock("../../../dashboard/src/v2/lib/project-api.js", () => ({
  fetchLocalDirectories: vi.fn(),
}));

describe("AddProjectModal", () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(fetchLocalDirectories).mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prefers the autofocus field when the modal opens", () => {
    render(<AddProjectModal onClose={vi.fn()} onAdd={vi.fn()} />);

    const nameInput = screen.getByLabelText(/Project Name/i);

    vi.advanceTimersByTime(60);

    expect(document.activeElement).toBe(nameInput);
  });

  it("keeps focus on the name field while typing", () => {
    render(<AddProjectModal onClose={vi.fn()} onAdd={vi.fn()} />);

    const nameInput = screen.getByLabelText(/Project Name/i) as HTMLInputElement;
    nameInput.focus();

    fireEvent.input(nameInput, { target: { value: "A" } });
    vi.advanceTimersByTime(60);

    expect(nameInput.value).toBe("A");
    expect(document.activeElement).toBe(nameInput);
  });

  it("keeps a stable modal height for local and git project forms", () => {
    render(<AddProjectModal onClose={vi.fn()} onAdd={vi.fn()} />);

    const dialogCard = screen.getByRole("dialog").firstElementChild as HTMLElement;
    expect(dialogCard.style.minHeight).toBe("min(640px, calc(100dvh - 2rem))");

    fireEvent.click(screen.getByRole("button", { name: /git url/i }));

    expect(dialogCard.style.minHeight).toBe("min(640px, calc(100dvh - 2rem))");
  });

  it("preselects the local project source by default", () => {
    render(<AddProjectModal onClose={vi.fn()} onAdd={vi.fn()} />);

    expect(screen.getByRole("button", { name: /local project/i }).className).toContain("bg-ember-500");
    expect(screen.queryByLabelText(/repository url/i)).not.toBeInTheDocument();
  });

  it("preselects the new project flow and hides setup controls", () => {
    render(<AddProjectModal onClose={vi.fn()} onAdd={vi.fn()} initialSourceType="new_project" />);

    const newProjectButtons = screen.getAllByRole("button", { name: /new project/i });
    expect(newProjectButtons.some((button) => button.className.includes("bg-ember-500"))).toBe(true);
    expect(screen.getByRole("button", { name: /local repo/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remote repo/i })).toBeInTheDocument();
    expect(screen.queryByText(/Initialize with Project Setup Agent/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Docs/i })).not.toBeInTheDocument();
  });

  it("hides git inputs and allows a blank local directory path", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddProjectModal onClose={vi.fn()} onAdd={onAdd} />);

    expect(screen.queryByLabelText(/repository url/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/clone into directory/i)).not.toBeInTheDocument();

    const nameInput = screen.getByLabelText(/Project Name/i);
    fireEvent.input(nameInput, { target: { value: "Alpha" } });
    await waitFor(() => expect(nameInput).toHaveValue("Alpha"));
    const initSwitch = screen.queryByLabelText(/Initialize with Project/i) || screen.queryByRole("switch");
        if (initSwitch) {
            fireEvent.click(initSwitch);
        }
    const form = screen.getByLabelText(/Project Name/i).closest("form");
    fireEvent.submit(form!);

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith({
      name: "Alpha",
      type: "local",
      path: "",
      setup: {
        enabled: false,
        options: {
          agents: true,
          quicksprints: true,
          previewScript: false,
          ci: true,
          techstack: true,
          docs: false,
        },
      },
    });
  });

  it("renders the Docs setup option and submits docs only when selected", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddProjectModal onClose={vi.fn()} onAdd={onAdd} />);

    const nameInput = screen.getByLabelText(/Project Name/i);
    fireEvent.input(nameInput, { target: { value: "Docs Project" } });
    await waitFor(() => expect(nameInput).toHaveValue("Docs Project"));

    const form = nameInput.closest("form");
    fireEvent.submit(form!);

    const docsOption = screen.getByRole("button", { name: /Docs/i });
    expect(docsOption).toHaveAttribute("aria-pressed", "false");
    expect(onAdd).not.toHaveBeenCalled();

    fireEvent.click(docsOption);
    expect(docsOption).toHaveAttribute("aria-pressed", "true");

    fireEvent.submit(form!);

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith({
      name: "Docs Project",
      type: "local",
      path: "",
      setup: {
        enabled: true,
        options: {
          agents: true,
          quicksprints: true,
          previewScript: false,
          ci: true,
          techstack: true,
          docs: true,
        },
      },
    });
  });

  it("includes Docs when selecting all setup options", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddProjectModal onClose={vi.fn()} onAdd={onAdd} />);

    const nameInput = screen.getByLabelText(/Project Name/i);
    fireEvent.input(nameInput, { target: { value: "All Setup Project" } });
    await waitFor(() => expect(nameInput).toHaveValue("All Setup Project"));

    const form = nameInput.closest("form");
    fireEvent.submit(form!);

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByRole("button", { name: /Docs/i })).toHaveAttribute("aria-pressed", "true");

    fireEvent.submit(form!);

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      setup: {
        enabled: true,
        options: {
          agents: true,
          quicksprints: true,
          previewScript: true,
          ci: true,
          techstack: true,
          docs: true,
        },
      },
    }));
  });

  it("submits the new project local payload without a slug", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddProjectModal onClose={vi.fn()} onAdd={onAdd} initialSourceType="new_project" />);

    fireEvent.click(screen.getByRole("button", { name: /local repo/i }));
    expect(screen.queryByLabelText(/git url slug/i)).not.toBeInTheDocument();

    const nameInput = screen.getByLabelText(/Project Name/i);
    fireEvent.input(nameInput, { target: { value: "Alpha" } });
    await waitFor(() => expect(nameInput).toHaveValue("Alpha"));
    fireEvent.input(screen.getByLabelText(/Directory Path/i), { target: { value: "/tmp/alpha" } });
    await waitFor(() => expect(screen.getByLabelText(/Directory Path/i)).toHaveValue("/tmp/alpha"));
    const form = screen.getByLabelText(/Project Name/i).closest("form");
    fireEvent.submit(form!);

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith({
      name: "Alpha",
      type: "new_project",
      path: "/tmp/alpha",
      initMode: "new-local",
      selectedTechstackId: "code-ux-internal",
      applicationKind: null,
    });
  });

  it("passes quickaction application kind and selected techstack through new project submissions", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(
      <AddProjectModal
        onClose={vi.fn()}
        onAdd={onAdd}
        initialSourceType="new_project"
        quickActionDefaults={{ applicationKind: "desktop", selectedTechstackId: "react-saas" }}
      />,
    );

    expect(screen.getByRole("heading", { name: /Create Desktop App/i })).toBeInTheDocument();

    const nameInput = screen.getByLabelText(/Project Name/i);
    fireEvent.input(nameInput, { target: { value: "Desk App" } });
    await waitFor(() => expect(nameInput).toHaveValue("Desk App"));
    fireEvent.submit(nameInput.closest("form")!);

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith({
      name: "Desk App",
      type: "new_project",
      path: "",
      initMode: "new-local",
      selectedTechstackId: "react-saas",
      applicationKind: "desktop",
    });
  });

  it("submits the new project remote payload with an auto-generated slug", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddProjectModal onClose={vi.fn()} onAdd={onAdd} initialSourceType="new_project" />);

    fireEvent.click(screen.getByRole("button", { name: /remote repo/i }));

    const nameInput = screen.getByLabelText(/Project Name/i) as HTMLInputElement;
    const slugInput = screen.getByLabelText(/Git URL Slug/i) as HTMLInputElement;

    fireEvent.input(nameInput, { target: { value: "Alpha Beta" } });

    await waitFor(() => expect(nameInput).toHaveValue("Alpha Beta"));
    await waitFor(() => expect(slugInput).toHaveValue("alpha-beta"));

    fireEvent.submit(nameInput.closest("form")!);

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith({
      name: "Alpha Beta",
      type: "new_project",
      path: "",
      initMode: "new-remote",
      selectedTechstackId: "code-ux-internal",
      applicationKind: null,
      repoSlug: "alpha-beta",
      remoteProvider: "github",
      isPrivate: true,
    });
  });

  it("submits unchanged local and Git import payloads from the German modal", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const first = render(<AddProjectModal onClose={vi.fn()} onAdd={onAdd} />, "de");

    fireEvent.input(screen.getByLabelText(/Projektname/i), { target: { value: "Lokales Projekt" } });
    fireEvent.input(screen.getByLabelText(/Verzeichnispfad/i), { target: { value: "/workspace/lokal" } });
    fireEvent.click(screen.getByText("Mit Projekteinrichtungs-Agent initialisieren").closest("label")!);
    fireEvent.submit(screen.getByLabelText(/Projektname/i).closest("form")!);

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({
      name: "Lokales Projekt",
      type: "local",
      path: "/workspace/lokal",
      setup: {
        enabled: false,
        options: {
          agents: true,
          quicksprints: true,
          previewScript: false,
          ci: true,
          techstack: true,
          docs: false,
        },
      },
    }));

    first.unmount();
    onAdd.mockClear();
    render(<AddProjectModal onClose={vi.fn()} onAdd={onAdd} />, "de");
    fireEvent.click(screen.getByRole("button", { name: "Git-URL" }));
    fireEvent.input(screen.getByLabelText(/Projektname/i), { target: { value: "Remote Projekt" } });
    fireEvent.input(screen.getByLabelText(/Repository-URL/i), { target: { value: "https://example.com/team/repo.git" } });
    fireEvent.input(screen.getByLabelText(/In Verzeichnis klonen/i), { target: { value: "/workspace/clones" } });
    fireEvent.click(screen.getByText("Mit Projekteinrichtungs-Agent initialisieren").closest("label")!);
    fireEvent.submit(screen.getByLabelText(/Projektname/i).closest("form")!);

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({
      name: "Remote Projekt",
      type: "git",
      path: "https://example.com/team/repo.git",
      cloneDir: "/workspace/clones",
      setup: {
        enabled: false,
        options: {
          agents: true,
          quicksprints: true,
          previewScript: false,
          ci: true,
          techstack: true,
          docs: false,
        },
      },
    }));
  });

  it("announces German validation without translating entered values or API failures", async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error("provider diagnostic 42"));
    render(<AddProjectModal onClose={vi.fn()} onAdd={onAdd} />, "de");
    fireEvent.click(screen.getByRole("button", { name: "Git-URL" }));
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Erforderliche Felder prüfen");
      expect(screen.getByText("Projektname ist erforderlich.")).toBeInTheDocument();
      expect(screen.getByText("Repository-URL ist erforderlich.")).toBeInTheDocument();
    });

    fireEvent.input(screen.getByLabelText(/Projektname/i), { target: { value: "Unverändert" } });
    fireEvent.input(screen.getByLabelText(/Repository-URL/i), { target: { value: "ssh://host/Unverändert.git" } });
    fireEvent.click(screen.getByText("Mit Projekteinrichtungs-Agent initialisieren").closest("label")!);
    fireEvent.submit(screen.getByLabelText(/Projektname/i).closest("form")!);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("provider diagnostic 42"));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      name: "Unverändert",
      path: "ssh://host/Unverändert.git",
    }));
  });

  it("browses into a directory and applies it to the local path input", async () => {
    vi.mocked(fetchLocalDirectories)
      .mockResolvedValueOnce({
        currentPath: "/home/user",
        parentPath: "/home",
        rootPath: "/",
        homePath: "/home/user",
        directories: [{ name: "project", path: "/home/user/project" }],
      })
      .mockResolvedValueOnce({
        currentPath: "/home/user/project",
        parentPath: "/home/user",
        rootPath: "/",
        homePath: "/home/user",
        directories: [],
      });

    render(<AddProjectModal onClose={vi.fn()} onAdd={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /browse/i }));

    expect(await screen.findByText("/home/user")).toBeInTheDocument();
    expect(screen.getByText(/1 child directory in \/home\/user\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^project$/i }));

    expect(await screen.findByText("/home/user/project")).toBeInTheDocument();
    expect(screen.getByText(/No child directories in \/home\/user\/project/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^use$/i }));

    expect(screen.getByLabelText(/Directory Path/i)).toHaveValue("/home/user/project");
    expect(screen.getByText("Selected directory: /home/user/project")).toBeInTheDocument();
  });

  it("formats the German directory-picker count with the active locale", async () => {
    vi.mocked(fetchLocalDirectories).mockResolvedValue({
      currentPath: "/home/user",
      parentPath: "/home",
      rootPath: "/",
      homePath: "/home/user",
      directories: Array.from({ length: 1000 }, (_, index) => ({
        name: `directory-${index}`,
        path: `/home/user/directory-${index}`,
      })),
    });

    render(<AddProjectModal onClose={vi.fn()} onAdd={vi.fn()} />, "de");
    fireEvent.click(screen.getByRole("button", { name: "Durchsuchen" }));

    expect(await screen.findByText("1.000 Unterverzeichnisse in /home/user.")).toBeInTheDocument();
  });

  it("applies the directory picker selection to the optional clone directory", async () => {
    vi.mocked(fetchLocalDirectories)
      .mockResolvedValueOnce({
        currentPath: "/home/user",
        parentPath: "/home",
        rootPath: "/",
        homePath: "/home/user",
        directories: [{ name: "repos", path: "/home/user/repos" }],
      })
      .mockResolvedValueOnce({
        currentPath: "/home/user/repos",
        parentPath: "/home/user",
        rootPath: "/",
        homePath: "/home/user",
        directories: [],
      });

    render(<AddProjectModal onClose={vi.fn()} onAdd={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /git url/i }));
    fireEvent.click(screen.getByRole("button", { name: /browse/i }));

    expect(await screen.findByText("/home/user")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^repos$/i }));

    expect(await screen.findByText("/home/user/repos")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^use$/i }));

    expect(screen.getByLabelText(/Clone Into Directory/i)).toHaveValue("/home/user/repos");
    expect(screen.getByText("Selected directory: /home/user/repos")).toBeInTheDocument();
  });

  it("shows directory picker loading and failure feedback without moving focus", async () => {
    let rejectLoad: (error: Error) => void = () => {};
    vi.mocked(fetchLocalDirectories).mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectLoad = reject;
    }));

    render(<AddProjectModal onClose={vi.fn()} onAdd={vi.fn()} />);

    const browseButton = screen.getByRole("button", { name: /browse/i });
    browseButton.focus();
    fireEvent.click(browseButton);

    expect(screen.getAllByText(/Loading directories/i).length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(browseButton);

    rejectLoad(new Error("Permission denied"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Permission denied");
      expect(screen.getByText(/Directory load failed: Permission denied/i)).toBeInTheDocument();
    });
    expect(document.activeElement).toBe(browseButton);
  });

  it("keeps the modal open and exposes retry when project submission fails", async () => {
    const onAdd = vi.fn()
      .mockRejectedValueOnce(new Error("Create failed"))
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(<AddProjectModal onClose={onClose} onAdd={onAdd} />);

    fireEvent.input(screen.getByLabelText(/Project Name/i), { target: { value: "Retry Project" } });
    fireEvent.click(screen.getByText(/Initialize with Project Setup Agent/i).closest("label")!);
    fireEvent.submit(screen.getByLabelText(/Project Name/i).closest("form")!);

    await waitFor(() => {
      expect(screen.getByText("Create failed")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledTimes(2);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
