"use client";

import { createElement, useEffect, useState, type SubmitEventHandler } from "react";

import type { Locale } from "../lib/data/registry";

interface Task {
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
}

const initialTasks: readonly Task[] = [
  { id: "reading-response", title: "Draft reading response", done: false },
  { id: "transit-check", title: "Review transit notes", done: false },
];

const builtInTaskTitles: Record<string, Record<Locale, string>> = {
  "reading-response": { en: "Draft reading response", "zh-CN": "起草阅读回应" },
  "transit-check": { en: "Review transit notes", "zh-CN": "核对交通记录" },
};

export function TaskBoard({ locale }: { readonly locale: Locale }) {
  const [tasks, setTasks] = useState<readonly Task[]>(initialTasks);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const isChinese = locale === "zh-CN";

  useEffect(() => {
    const saved = window.localStorage.getItem("uga.tasks");
    if (saved === null) return;
    try {
      const parsed: unknown = JSON.parse(saved);
      if (Array.isArray(parsed)) setTasks(parsed as Task[]);
    } catch {
      window.localStorage.removeItem("uga.tasks");
    }
  }, []);

  const persist = (nextTasks: readonly Task[]) => {
    setTasks(nextTasks);
    window.localStorage.setItem("uga.tasks", JSON.stringify(nextTasks));
  };

  const toggle = (id: string) => {
    persist(tasks.map((task) => (task.id === id ? { ...task, done: !task.done } : task)));
  };

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const title = draft.trim();
    if (title.length === 0) {
      setStatus(isChinese ? "请输入任务名称" : "Enter a task name");
      return;
    }
    const nextTasks = [...tasks, { id: `local-${Date.now()}`, title, done: false }];
    persist(nextTasks);
    setDraft("");
    setStatus(isChinese ? "任务已添加" : "Task added");
  };

  return createElement(
    "section",
    { className: "task-board", "aria-labelledby": "tasks-title" },
    createElement("h2", { id: "tasks-title" }, isChinese ? "任务" : "Tasks"),
    createElement(
      "ul",
      { className: "task-list" },
      tasks.map((task) => {
        const title = builtInTaskTitles[task.id]?.[locale] ?? task.title;
        return createElement(
          "li",
          { key: task.id },
          createElement(
            "label",
            { className: "check-row" },
            createElement("input", {
              "aria-label": title,
              checked: task.done,
              onChange: () => toggle(task.id),
              type: "checkbox",
            }),
            createElement("span", { className: task.done ? "task-done" : undefined }, title),
          ),
        );
      }),
    ),
    createElement(
      "form",
      { className: "inline-form", onSubmit: submit },
      createElement("label", { htmlFor: "new-task" }, isChinese ? "新任务" : "New task"),
      createElement("input", {
        id: "new-task",
        onChange: (event) => setDraft(event.target.value),
        value: draft,
      }),
      createElement("button", { className: "button", type: "submit" }, isChinese ? "添加任务" : "Add task"),
    ),
    createElement("p", { className: "form-status", role: "status", "aria-live": "polite" }, status),
  );
}
