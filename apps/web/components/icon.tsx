import type { SVGProps } from "react";

const paths = {
  today: "M5 6.5h14M7 3v5m10-5v5M5 10h14v10H5zM8 14h3m2 0h3m-8 3h3",
  explore: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5.5 12.5L21 21M8 12l3-5 2 4 4 2-5 3Z",
  plan: "M6 4h12v16H6zM9 8h6m-6 4h6m-6 4h4",
  community: "M8 17 4 20l1.3-4.2A7 7 0 1 1 8 17Zm1-7h6m-6 3h4",
  world:
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.4 2.5 3.5 5.5 3.5 9S14.4 18.5 12 21m0-18C9.6 5.5 8.5 8.5 8.5 12s1.1 6.5 3.5 9M3 12h18",
  ai: "m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4ZM6 15l.8 2.2L9 18l-2.2.8L6 21l-.8-2.2L3 18l2.2-.8Z",
  admin: "M4 7h16M7 4v6m10-6v6M5 12h14v8H5zm3 3h3m2 0h3",
  developer: "m9 7-5 5 5 5m6-10 5 5-5 5m-4 3 2-16",
  search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm5 11L21 21",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  arrow: "M5 12h14m-5-5 5 5-5 5",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, ...props }: { readonly name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      <path
        d={paths[name]}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}
