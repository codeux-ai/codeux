import { createInterface } from "readline/promises";
import type { ReadStream, WriteStream } from "node:tty";

export interface PromptSession {
  ask: (question: string) => Promise<string>;
  close: () => Promise<void> | void;
}

export interface PromptIO {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
}

export function createPromptSession(input: ReadStream, output: WriteStream): PromptSession {
  const interfaceInstance = createInterface({
    input,
    output,
  });

  return {
    ask: async (question: string) => interfaceInstance.question(question),
    close: async () => {
      interfaceInstance.close();
    },
  };
}

export async function promptForValues(
  io: PromptIO,
  prompts: Array<{ key: string; label: string; defaultValue?: string }>,
): Promise<Record<string, string>> {
  const session = createPromptSession(io.stdin as ReadStream, io.stdout as WriteStream);
  const values: Record<string, string> = {};

  try {
    for (const prompt of prompts) {
      const suffix = prompt.defaultValue ? ` [${prompt.defaultValue}]` : "";
      const answer = await session.ask(`${prompt.label}${suffix}: `);
      const trimmed = answer.trim();
      values[prompt.key] = trimmed.length > 0 ? trimmed : (prompt.defaultValue ?? "");
    }
    return values;
  } finally {
    await session.close();
  }
}

