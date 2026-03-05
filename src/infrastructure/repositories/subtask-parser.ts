import type { Subtask } from "../../contracts/app-types.js";

export class SubtaskParser {
  /**
   * Parses the content of a subtask markdown file.
   */
  static parse(id: string, content: string): Subtask {
    const lines = content.split(/\r?\n/);
    const metadata: Record<string, string> = {};
    let promptStartIndex = -1;

    let currentKey: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check if this is the start of the prompt section
      const promptMatch = line.match(/^\s*prompt:\s*(.*)$/i);
      if (promptMatch) {
        promptStartIndex = i;
        // If there's content on the same line as "prompt:", we'll include it in the prompt
        break;
      }

      // Parse key-value pairs
      const kvMatch = line.match(/^\s*([a-z0-9_]+)\s*:\s*(.*)$/i);
      if (kvMatch) {
        const key = kvMatch[1].toLowerCase();
        const value = kvMatch[2].trim();
        metadata[key] = value;
        currentKey = key;
      } else if (currentKey && line.trim() !== "") {
        // Handle multiline properties by appending
        metadata[currentKey] += " " + line.trim();
      }
    }

    let prompt = "";
    if (promptStartIndex !== -1) {
      // Extract everything from "prompt:" onwards
      const firstLine = lines[promptStartIndex].match(/^\s*prompt:\s*(.*)$/i)?.[1] || "";
      const remainingLines = lines.slice(promptStartIndex + 1);
      prompt = [firstLine, ...remainingLines].join("\n").trim();
    } else {
      // Fallback if no prompt: section found
      prompt = content.trim();
    }

    return {
      id,
      title: metadata["title"] || id,
      prompt,
      depends_on: this.parseDependsOn(metadata["depends_on"] || ""),
      is_independent: metadata["is_independent"] !== "false", // Default to true
      is_merged: metadata["merged"] === "true",
      status: "PENDING",
    };
  }

  /**
   * Parses the depends_on array string.
   * Supports formats like: [task1, task2], ["task1", "task2"], [ task1 ]
   */
  static parseDependsOn(value: string): string[] {
    if (!value) return [];
    
    // Remove brackets
    const match = value.match(/^\s*\[(.*)\]\s*$/);
    if (!match) return [];

    const content = match[1];
    if (!content.trim()) return [];

    // Robust parsing of comma-separated items that might be quoted
    const items: string[] = [];
    let currentItem = "";
    let inQuotes: string | null = null;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];

      if (inQuotes) {
        if (char === inQuotes) {
          inQuotes = null;
        } else {
          currentItem += char;
        }
      } else {
        if (char === '"' || char === "'") {
          inQuotes = char;
        } else if (char === ',') {
          if (currentItem.trim().length > 0) {
            items.push(currentItem.trim());
          }
          currentItem = "";
        } else {
          currentItem += char;
        }
      }
    }

    if (currentItem.trim().length > 0) {
      items.push(currentItem.trim());
    }

    return items;
  }

  /**
   * Serializes a Subtask object back into the markdown format.
   */
  static stringify(subtask: Subtask): string {
    const lines: string[] = [];
    lines.push(`title: ${subtask.title}`);
    
    if (subtask.depends_on && subtask.depends_on.length > 0) {
      // Always quote dependencies for robustness and format with spaces
      // Sort dependencies alphabetically for deterministic output
      const sortedDeps = [...subtask.depends_on].sort();
      const formattedDeps = sortedDeps.map(dep => `"${dep}"`).join(", ");
      lines.push(`depends_on: [${formattedDeps}]`);
    } else {
      lines.push(`depends_on: []`);
    }

    lines.push(`is_independent: ${subtask.is_independent}`);
    lines.push(`merged: ${!!subtask.is_merged}`);
    lines.push(`prompt:`);
    lines.push(subtask.prompt);

    return lines.join("\n");
  }
}
