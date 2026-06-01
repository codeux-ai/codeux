const BOOTSTRAP_BRANCH_FATAL_LINE_PATTERN =
  /^fatal:\s+your current branch 'code-ux-bootstrap-[^']+' does not have any commits yet\s*$/i;

export const sanitizeInvocationOutputText = (value: string): string => {
  if (!value) {
    return value;
  }

  const lines = value.split("\n");
  const filtered = lines.filter((line) => !BOOTSTRAP_BRANCH_FATAL_LINE_PATTERN.test(line.trim()));
  return filtered.join("\n");
};

