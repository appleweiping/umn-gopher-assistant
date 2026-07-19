import { createElement } from "react";

import type { Freshness } from "../lib/data/registry";

export function SourceBadge(props: {
  readonly freshness: Freshness;
  readonly label: string;
  readonly updatedLabel: string;
  readonly url: string;
}) {
  return createElement(
    "span",
    { className: `source-badge source-${props.freshness}` },
    createElement("span", null, props.freshness),
    createElement("span", { "aria-hidden": "true" }, "·"),
    createElement(
      "a",
      {
        "aria-label": `${props.label} (opens in a new tab)`,
        className: "source-link",
        href: props.url,
        rel: "noopener noreferrer",
        target: "_blank",
      },
      props.label,
      createElement("span", { "aria-hidden": "true" }, " ↗"),
    ),
    createElement("span", { className: "source-updated" }, props.updatedLabel),
  );
}

export function SchematicMap(props: {
  readonly label: string;
  readonly points: readonly {
    readonly id: string;
    readonly label: string;
    readonly x: number;
    readonly y: number;
  }[];
}) {
  return createElement(
    "div",
    { className: "schematic-map" },
    createElement(
      "svg",
      { "aria-label": props.label, className: "schematic-map-canvas", role: "img", viewBox: "0 0 100 70" },
      createElement("path", {
        d: "M4 57 C20 48 27 50 39 33 S71 15 96 9",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "1.5",
      }),
      createElement("path", {
        d: "M8 17 H91 M17 6 V64 M54 4 V66",
        fill: "none",
        opacity: "0.22",
        stroke: "currentColor",
      }),
      props.points.map((point) =>
        createElement(
          "g",
          { key: point.id },
          createElement("circle", { cx: point.x, cy: point.y, r: "3" }),
          createElement("text", { x: point.x + 4, y: point.y + 1, fontSize: "4" }, point.label),
        ),
      ),
    ),
    createElement(
      "ul",
      { "aria-label": `${props.label} locations`, className: "schematic-map-list" },
      props.points.map((point) => createElement("li", { key: point.id }, point.label)),
    ),
  );
}
