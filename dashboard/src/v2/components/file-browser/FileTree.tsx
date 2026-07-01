import type { FunctionComponent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Tree } from "react-arborist";
import type { NodeRendererProps } from "react-arborist";
import { ChevronRight, File as FileIcon, Folder, FolderOpen } from "lucide-preact";
import { useMemo } from "preact/hooks";
import type { FileBrowserTreeNode } from "../../../types.js";


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
}

const TreeNodeRow: FunctionComponent<NodeRendererProps<FileBrowserTreeNode>> = ({ node, style, dragHandle, tree }) => {
  const isDirectory = node.data.type === "directory";
  const searchTerm = tree.props.searchTerm;
  const isSelected = node.isSelected && !isDirectory;

  return (
    <div
      ref={dragHandle}
      style={style}
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
    >
      <span class="flex h-4 w-4 shrink-0 items-center justify-center text-slate-400">
        {isDirectory ? (
          <ChevronRight
            class={`h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none ${node.isOpen ? "rotate-90" : ""}`}
            strokeWidth={2.4}
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
      <span class="truncate font-medium"><HighlightMatch text={node.data.name} term={searchTerm} /></span>
    </div>
  );
};

export const FileTree: FunctionComponent<FileTreeProps> = ({ nodes, selectedPath, onSelectFile, searchTerm }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 320, height: 480 });

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
    <div ref={containerRef} class="h-full w-full overflow-hidden">
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
        {TreeNodeRow}
      </Tree>
    </div>
  );
};
