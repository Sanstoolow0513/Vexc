import type { HintSuggestion } from "./types";

interface HintRule {
  id: string;
  languages?: string[];
  keywords: string[];
  title: string;
  message: string;
  insertText: string;
}

const RULES: HintRule[] = [
  {
    id: "todo-breakdown",
    keywords: ["todo", "plan", "phase", "milestone"],
    title: "拆分任务骨架",
    message: "可以先落一段可执行任务清单，后续补细节。",
    insertText: "\n// TODO: deliverable\n// - scope\n// - constraints\n// - acceptance\n",
  },
  {
    id: "error-guard",
    languages: ["typescript", "javascript", "rust"],
    keywords: ["invoke(", "fetch(", "command", "terminal"],
    title: "补错误保护",
    message: "这里建议加 try/catch 和用户可读错误提示。",
    insertText: "\ntry {\n  // action\n} catch (error) {\n  console.error(error);\n}\n",
  },
  {
    id: "state-sync",
    languages: ["typescript", "javascript"],
    keywords: ["usestate", "set", "tab", "workspace"],
    title: "状态同步检查",
    message: "涉及多个面板联动时，先统一主状态再渲染。",
    insertText: "\n// Keep single source of truth for cross-panel state.\n",
  },
  {
    id: "security-path",
    languages: ["rust", "typescript"],
    keywords: ["path", "file", "write", "read"],
    title: "路径边界提醒",
    message: "文件操作前建议先校验 workspace 边界。",
    insertText: "\n// Validate workspace boundaries before any file operation.\n",
  },
  {
    id: "test-scenario",
    keywords: ["test", "verify", "done", "acceptance"],
    title: "验收场景模板",
    message: "建议补 3 条最小手工验收路径。",
    insertText: "\n// Manual checks:\n// 1) happy path\n// 2) bad input\n// 3) recovery flow\n",
  },
];

function matchLanguage(rule: HintRule, language: string): boolean {
  if (!rule.languages || rule.languages.length === 0) {
    return true;
  }
  return rule.languages.includes(language.toLowerCase());
}

function matchKeyword(rule: HintRule, content: string): boolean {
  const contentLower = content.toLowerCase();
  return rule.keywords.some((keyword) => contentLower.includes(keyword));
}

export function buildHints(content: string, language: string): HintSuggestion[] {
  const tail = content.slice(Math.max(content.length - 320, 0));
  return RULES.filter((rule) => matchLanguage(rule, language) && matchKeyword(rule, tail)).map(
    (rule) => ({
      id: rule.id,
      title: rule.title,
      message: rule.message,
      insertText: rule.insertText,
    }),
  );
}
