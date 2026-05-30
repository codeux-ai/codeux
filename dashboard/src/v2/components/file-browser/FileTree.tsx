import type { FunctionComponent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Tree } from "react-arborist";
import type { NodeRendererProps } from "react-arborist";
import { ChevronRight, File as FileIcon, Folder, FolderOpen } from "lucide-preact";
import type { FileBrowserTreeNode } from "../../../types.js";

interface FileTreeProps {
  nodes: FileBrowserTreeNode[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  searchTerm?: string;
}

const TreeNodeRow: FunctionComponent<NodeRendererProps<FileBrowserTreeNode>> = ({ node, style, dragHandle }) => {
  const isDirectory = node.data.type === "directory";
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
      class={`group flex h-full items-center gap-1.5 rounded-lg pr-2 text-[13px] transition-colors cursor-pointer ${
        isSelected
          ? "bg-signal-500/15 text-slate-900 dark:text-white"
          : "text-slate-600 hover:bg-black/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.05]"
      }`}
    >
      <span class="flex h-4 w-4 shrink-0 items-center justify-center text-slate-400">
        {isDirectory ? (
          <ChevronRight
            class={`h-3.5 w-3.5 transition-transform duration-200 ${node.isOpen ? "rotate-90" : ""}`}
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
      <span class="truncate font-medium">{node.data.name}</span>
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
