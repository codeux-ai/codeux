export type DocsWebSection = "Getting Started" | "User Guide" | "Developer Reference" | "Architecture";

export interface DocsWebEntry {
  id: string;
  path: string;
  sourcePath: string;
  section: DocsWebSection;
  title: string;
  description: string;
}

export interface DocsWebDocument extends DocsWebEntry {
  contentMarkdown: string;
}

export interface DocsWebCollectionResponse {
  defaultDocId: string;
  docs: DocsWebEntry[];
  groupedDocs: Record<DocsWebSection, DocsWebEntry[]>;
}

export interface DocsWebDocumentResponse {
  doc: DocsWebDocument;
}
