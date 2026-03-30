const parseChatTime = (iso: string | null | undefined): Date | null => {
  if (!iso) {
    return null;
  }

  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const toChatTimestampMs = (iso: string | null | undefined, fallback = 0): number => {
  const date = parseChatTime(iso);
  return date ? date.getTime() : fallback;
};

export const formatChatTime = (iso: string | null | undefined): string => {
  const date = parseChatTime(iso);
  if (!date) {
    return "";
  }

  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

export const formatRelativeChatTime = (iso: string | null | undefined): string => {
  if (!iso) {
    return "No messages";
  }

  const timestamp = toChatTimestampMs(iso, Number.NaN);
  if (Number.isNaN(timestamp)) {
    return "Just now";
  }

  const diffMs = Math.max(0, Date.now() - timestamp);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) {
    return `${mins}m ago`;
  }

  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.floor(hours / 24)}d ago`;
};
