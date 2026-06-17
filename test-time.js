function getRelativeTime(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  if (Number.isNaN(diff)) return "";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day > 1 ? "s" : ""} ago`;
}
console.log(getRelativeTime(new Date(Date.now() - 1000).toISOString()));
console.log(getRelativeTime(new Date(Date.now() - 120000).toISOString()));
console.log(getRelativeTime(new Date(Date.now() - 7200000).toISOString()));
console.log(getRelativeTime(new Date(Date.now() - 86400000 * 2).toISOString()));
