const SEARCH_MAX_LENGTH = 100;

/** 搜索词当普通文本用：% 和 _ 不再是通配符。 */
export function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}

export function normalizeSearch(queryText: string): string {
  return [...queryText.trim()].slice(0, SEARCH_MAX_LENGTH).join("");
}
