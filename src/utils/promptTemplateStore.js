import { BUILTIN_PROMPT_TEMPLATES, isValidPromptTemplate } from '../config/promptTemplates.js';

const STORAGE_KEY = 'museai_prompt_templates_v1';

export function loadPromptTemplates() {
  const builtins = Array.isArray(BUILTIN_PROMPT_TEMPLATES) ? [...BUILTIN_PROMPT_TEMPLATES] : [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return builtins;
    const parsed = JSON.parse(raw);
    const custom = Array.isArray(parsed) ? parsed.filter(isValidPromptTemplate) : [];
    const builtinIds = new Set(builtins.map((t) => t.id));
    const merged = [...builtins];
    for (const t of custom) {
      if (builtinIds.has(t.id)) continue;
      merged.push(t);
    }
    return merged;
  } catch {
    return builtins;
  }
}

export function saveCustomPromptTemplates(templates) {
  const list = Array.isArray(templates) ? templates.filter(isValidPromptTemplate) : [];
  const builtinIds = new Set((BUILTIN_PROMPT_TEMPLATES || []).map((t) => t.id));
  const customOnly = list.filter((t) => !builtinIds.has(t.id));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customOnly));
  } catch {
    // ignore
  }
}

