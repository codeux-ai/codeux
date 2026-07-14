import type { FunctionComponent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Tree } from "react-arborist";
import type { NodeRendererProps } from "react-arborist";
import { ChevronRight, File as FileIcon, Folder, FolderOpen, Loader2 } from "lucide-preact";
import { useMemo } from "preact/hooks";
import type { FileBrowserTreeNode } from "../../../types.js";
import { buildInteractionTransition } from "../../lib/motion/tokens.js";
import { useDashboardI18n } from "../../i18n/context.js";
import { fileBrowserMessages } from "../../i18n/messages/file-browser.js";

const countMatchingNodes = (nodes: FileBrowserTreeNode[], searchTerm?: string): number => {
  const normalizedTerm = searchTerm?.trim().toLowerCase() ?? "";
  let count = 0;
  const visit = (node: FileBrowserTreeNode) => {
    if (!normalizedTerm || node.name.toLowerCase().includes(normalizedTerm)) {
      count += 1;
    }
    node.children?.forEach(visit);
  };
  nodes.forEach(visit);
  return count;
};

const HighlightMatch = ({ text, term }: { text: string; term?: string }) => {
  if (!term) return <span>{text}</span>;
  const index = text.toLowerCase().indexOf(term.toLowerCase());
  if (index === -1) return <span>{text}</span>;

  const before = text.slice(0, index);
  const match = text.slice(index, index + term.length);
  const after = text.slice(index + term.length);

  return (
    <span>
      {before}
      <mark class="bg-signal-500/30 text-inherit rounded-sm px-[1px]">{match}</mark>
      {after}
    </span>
  );
};

interface FileTreeProps {
  nodes: FileBrowserTreeNode[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  searchTerm?: string;
  loadingPath?: string | null;
}

const expansionTransition = buildInteractionTransition("expansionCollapse", "transform");
const selectionTransition = buildInteractionTransition("selectionMovement", "background-color, border-color, color, box-shadow");

const TreeNodeRow: FunctionComponent<NodeRendererProps<FileBrowserTreeNode> & { loadingPath?: string | null }> = ({ node, style, dragHandle, tree, loadingPath }) => {
  const { translate } = useDashboardI18n();
  const isDirectory = node.data.type === "directory";
  const searchTerm = tree.props.searchTerm;
  const isSelected = node.isSelected && !isDirectory;
  const isLoading = !isDirectory && loadingPath === node.data.path;
  const loadingDescriptionId = `file-tree-node-${node.data.id}-loading`;

  return (
    <div
      ref={dragHandle}
      id={`file-tree-node-${node.data.id}`}
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={isDirectory ? node.isOpen : undefined}
      aria-busy={isLoading}
      aria-describedby={isLoading ? loadingDescriptionId : undefined}
      aria-label={`${translate(fileBrowserMessages, isDirectory ? "folderPath" : "filePath", { path: node.data.path })}${isLoading ? translate(fileBrowserMessages, "loadingContentsSuffix") : ""}`}
      onClick={() => {
        if (isDirectory) {
          node.toggle();
        } else {
          node.select();
        }
      }}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (isDirectory) node.toggle();
          else node.select();
        }
      }}
      class={`group flex min-w-0 h-full items-center gap-1.5 rounded-lg pr-2 text-[13px] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-inset ${
        isSelected
          ? "bg-signal-500/[0.14] text-slate-900 ring-1 ring-inset ring-signal-500/25 dark:text-white"
          : "text-slate-600 hover:bg-black/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.05]"
      }`}
      title={isLoading ? translate(fileBrowserMessages, "loadingPath", { path: node.data.path }) : node.data.path}
      style={{ ...style, transition: selectionTransition }}
    >
      <span class="flex h-4 w-4 shrink-0 items-center justify-center text-slate-400">
        {isDirectory ? (
          <ChevronRight
            class={`h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none ${node.isOpen ? "rotate-90" : ""}`}
            strokeWidth={2.4}
            style={{ transition: expansionTransition }}
          />
        ) : null}
      </span>
      <span class={`flex h-4 w-4 shrink-0 items-center justify-center ${isDirectory ? "text-ember-500" : "text-sky-500"}`}>
        {isDirectory ? (
          node.isOpen ? <FolderOpen class="h-4 w-4" strokeWidth={1.8} /> : <Folder class="h-4 w-4" strokeWidth={1.8} />
        ) : (
          <FileIcon class="h-3.5 w-3.5" strokeWidth={1.8} />
      )}
      </span>
      <span class="min-w-0 break-words font-medium leading-5"><HighlightMatch text={node.data.name} term={searchTerm} /></span>
      {isLoading && (
        <span id={loadingDescriptionId} class="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-1.5 py-0.5 text-[10px] font-semibold text-signal-700 dark:text-signal-300">
          <Loader2 aria-hidden="true" class="h-3 w-3 animate-spin motion-reduce:animate-none" strokeWidth={2} />
          {translate(fileBrowserMessages, "loading")}
        </span>
      )}
    </div>
  );
};

export const FileTree: FunctionComponent<FileTreeProps> = ({ nodes, selectedPath, onSelectFile, searchTerm, loadingPath = null }) => {
  const { formatNumber, translate, translatePlural } = useDashboardI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 320, height: 480 });
  const resultCount = useMemo(() => countMatchingNodes(nodes, searchTerm), [nodes, searchTerm]);

  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === "undefined") {
      return;
    }
    const element = containerRef.current;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: Math.max(160, Math.floor(entry.contentRect.width)),
          height: Math.max(200, Math.floor(entry.contentRect.height)),
        });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      role="tree"
      aria-label={translate(fileBrowserMessages, "sprintFileTree")}
      class="h-full w-full overflow-hidden"
    >
      <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {searchTerm?.trim()
          ? translatePlural(fileBrowserMessages, "treeResultsMatch", resultCount, { formattedCount: formatNumber(resultCount), term: searchTerm })
          : translatePlural(fileBrowserMessages, "treeEntriesAvailable", resultCount, { formattedCount: formatNumber(resultCount) })}
        {" "}
        {selectedPath
          ? translate(fileBrowserMessages, "selectedFileAnnouncement", { path: selectedPath })
          : translate(fileBrowserMessages, "noFileSelectedAnnouncement")}
      </div>
      <Tree<FileBrowserTreeNode>
        data={nodes}
        idAccessor="id"
        childrenAccessor={(node) => node.children ?? null}
        openByDefault={false}
        width={dimensions.width}
        height={dimensions.height}
        indent={14}
        rowHeight={30}
        searchTerm={searchTerm}
        searchMatch={(node, term) => node.data.name.toLowerCase().includes(term.toLowerCase())}
        selection={selectedPath ?? undefined}
        onSelect={(selectedNodes) => {
          const node = selectedNodes[0];
          if (node && node.data.type === "file") {
            onSelectFile(node.data.path);
          }
        }}
      >
        {(props: NodeRendererProps<FileBrowserTreeNode>) => <TreeNodeRow {...props} loadingPath={loadingPath} />}
      </Tree>
    </div>
  );
};
