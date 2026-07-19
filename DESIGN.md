# Campus Field Guide design system

Campus Field Guide is an independent, unofficial interface for five University
of Minnesota campuses. Its visual language combines a field notebook with a
small operations desk: warm paper, clear rules, compact status labels, and
strong navigation. It intentionally avoids University marks, Goldy artwork,
Block M geometry, official color specifications, photographs, and language
that could imply endorsement.

## Product influences and original boundary

The information architecture draws on three broad product patterns:

- student-built campus assistants demonstrate the value of one daily entry
  point and lightweight personalization;
- ASU Mobile demonstrates that campus switching and high-frequency tasks
  belong in the persistent shell;
- Michigan Campus Information demonstrates that maps must remain paired with
  searchable lists and service details.

Those are functional observations, not visual templates. Campus Field Guide
uses an original mark, original tokens, project-authored schematic maps, and a
different composition. It does not copy competitor assets, layouts, copy, or
interaction animation. Campus names appear only to identify the intended data
scope.

## Principles

1. **Source before certainty.** Data-bearing cards show freshness, source, and
   licensing posture. “Demo,” “unverified,” and “schematic” are never hidden.
2. **List before spectacle.** Every map, status graphic, and future 3D entry has
   a DOM text equivalent. The product works without canvas or a heavy 3D
   bundle.
3. **Daily density, calm hierarchy.** The interface carries useful detail, but
   a paper background, rules, and typographic rhythm keep it scannable.
4. **One shell, five contexts.** Campus, language, and theme persist at the
   shell level. Rochester keeps the UMNTC academic-institution mapping.
5. **Preview before mutation.** Community reports and developer write-like
   operations show a preview and explicit confirmation. This batch performs no
   external write.

## Mark

The original mark is a four-point compass crossed by a curved path. It suggests
orientation and a student’s changing route without resembling a letter M,
mascot, seal, or campus building. Source SVGs live in
`apps/web/public/brand` and `apps/web/public/icons`.

## Tokens

`design-tokens.json` is the canonical portable token file. Every value uses the
DTCG 2025.10 `$type`/`$value` form, including structured sRGB colors,
dimensions, durations, easing, and shadows. Matching CSS custom properties are
declared at the top of `apps/web/app/styles.css`; light and dark semantic colors
share the same property names inside their respective theme scopes.

### Color

- Deep pine (`#174F44`) is the primary action and navigation color.
- Lake blue (`#11667A`) identifies links, transit, and orientation.
- Warm terracotta (`#A44A31`) marks attention and active path details.
- Paper (`#F4F1E8`) and warm white (`#FFFCF5`) replace sterile pure-gray
  canvases.
- Dark mode is a complete semantic remap, not an inversion filter.

Normal text targets at least 4.5:1 contrast; large text and essential graphical
objects target at least 3:1. Status never relies on color alone: text labels and
border position remain visible in monochrome and forced-colors modes.

### Typography

- Display: Georgia/system serif for a field-guide voice and compact headings.
- Body: platform sans-serif for UI density and broad language coverage.
- Mono: platform monospace for IDs, contracts, timestamps, and scopes.

The scale runs from 12px metadata to a fluid 56px maximum page title. Body text
remains 16px. Headings use short line lengths and negative letter spacing only
at display sizes.

### Spacing, radius, and shadow

Spacing follows a 4px base with the practical sequence 4, 8, 12, 16, 24, 32,
48, and 64. Main controls are at least 44px tall; small secondary targets never
fall below 24px.

Radii communicate type:

- 4px for controls;
- 8px for bounded panels;
- 12px only for dialogs;
- full pills only for prompt chips and true circular controls.

Cards do not receive a universal rounded treatment. Many use a square field
note with a colored leading or top rule. Shadows are reserved for overlays,
hover elevation, and sticky navigation separation.

### Breakpoints

- 40rem: single-column content and stacked actions;
- 52rem: sidebar becomes bottom navigation;
- 72rem: dense desktop grids simplify;
- 90rem: content stops growing and preserves readable line length.

The layout reflows at 200–400% zoom. Wide schedule and audit tables use a
labelled, keyboard-focusable overflow region rather than shrinking text.

## Components

- **App shell:** desktop sidebar, context bar, mobile bottom navigation, More
  menu, source/connectivity status, and independent-project label.
- **Source badge:** freshness text, provenance link, and checked date.
- **Signal card:** one daily condition with explicit data limitations and
  reorder controls.
- **Schematic map:** SVG orientation layer plus a synchronized DOM list.
- **Dialog/menu/tabs:** Radix primitives supply focus containment, Escape,
  restoration, keyboard roving, and robust Name/Role/Value behavior.
- **Notice:** text plus leading rule for information, warning, and danger.
- **Preview panel:** structured operation payload, acknowledgement, and
  confirmation status.

## Accessibility contract

- A skip link targets `#main-content`; landmarks and headings remain ordered.
- Native links, buttons, selects, checkboxes, tables, and forms are preferred.
- Focus uses a 3px high-contrast outline with 3px offset.
- Primary touch controls are 44px; checkbox hit regions include their labels.
- Dialog focus is contained and restored by Radix; Escape remains available.
- `aria-live` announces connectivity, filters, exports, local saves, reports,
  and no-result states without moving focus.
- Reduced-motion mode removes nonessential animation; forced-colors adds
  explicit borders.
- English and Simplified Chinese use the same complete message key set.

## Content and trust rules

“Official” describes a linked source, never this product. No page claims a
real-time connector, partnership, accessible route, emergency authority, or
successful external write. `OPEN_REUSE` is reserved for the three explicitly
confirmed public event feeds; other records remain `DEEPLINK_ONLY`,
`LIVE_ONLY`, or `APPROVAL_REQUIRED`. Service-worker caches exclude external
origins, `/v1`, `/api`, authentication, and live/safety responses.
