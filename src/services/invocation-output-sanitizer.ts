const BOOTSTRAP_BRANCH_FATAL_LINE_PATTERN =
  /^fatal:\s+your current branch 'code-ux-bootstrap-[^']+' does not have any commits yet\s*$/i;
const QWEN_LEGACY_OPENAI_LOGGING_WARNING_LINE_PATTERN =
  /^Warning:\s+Legacy setting 'enableOpenAILogging' will be ignored in .*?\.qwen\/settings\.json\.\s+Please use 'model\.enableOpenAILogging' instead\.\s*$/i;
const QWEN_LEGACY_OPENAI_LOGGING_WARNING_TEXT_PATTERN =
  /\s*Warning:\s+Legacy setting 'enableOpenAILogging' will be ignored in .*?\.qwen\/settings\.json\.\s+Please use 'model\.enableOpenAILogging' instead\./gi;

export const sanitizeInvocationOutputText = (value: string): string => {
  if (!value) {
    return value;
  }

  const lines = value.split("\n");
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    return !BOOTSTRAP_BRANCH_FATAL_LINE_PATTERN.test(trimmed)
      && !QWEN_LEGACY_OPENAI_LOGGING_WARNING_LINE_PATTERN.test(trimmed);
  });
  return filtered.join("\n").replace(QWEN_LEGACY_OPENAI_LOGGING_WARNING_TEXT_PATTERN, "").trim();
};
