# AI Book Studio — Editorial Workspace v2

## Product lane
AI-assisted publishing and long-form manuscript production software for individual writers, students, educators and solo creators.

AI Book Studio is a **product workspace**, not a marketing dashboard, book gallery, or generic AI chat UI. The manuscript is the primary object. Navigation, generation status and AI controls must support it without visually competing with it.

## Reference synthesis

### UI UX Pro Max
The v2 direction combines the repository's **Swiss Modernism 2.0**, **E-Ink / Paper**, and **Editorial Grid / Magazine** lanes:
- strong grid and typographic hierarchy
- paper/material metaphor only for the manuscript itself
- quiet application chrome
- one global design system rather than page-by-page styling

### Impeccable
The final critique rules used by this project are:
- no oversized empty SaaS hero
- no cards nested in cards
- no purple/blue gradient branding
- no low-contrast gray copy
- no meaningless icon tiles or badges
- no desktop layout merely stacked vertically on mobile
- hierarchy must come from content, type, spacing and alignment before decoration

### shadcn/ui
The repository does not use Tailwind/Radix today, so the shadcn package is not added merely for appearance. Its interaction conventions are still used for mobile Sheets/Drawers: explicit trigger state, `aria-controls`, `aria-expanded`, scrim dismissal, clear panel headings, close controls and large touch targets.

### Magic UI
Motion is used only where it explains live system state. The active generation progress receives a restrained moving highlight; decorative hero animation is intentionally excluded.

### 21st.dev / 21st MCP
The current ChatGPT environment has no 21st MCP connector/plugin available. Its MCP package cannot be invoked from this environment, so implementation does not block on it. Composition is instead evaluated against the same high-quality navigation, drawer, editor and dashboard pattern criteria.

## Core visual direction
**Editorial Workspace**

The first redesign leaned too heavily on a dark “production console” metaphor. v2 removes that split personality. The application shell, creation wizard and editor now share a calm neutral workspace:
- canvas: warm-neutral off-white
- controls/panels: white or near-white
- manuscript: true white paper with physical depth
- text: near-black
- one cobalt action color
- semantic colors only for success/warning/error

The dark rail is no longer a primary brand device.

## Color
- Canvas: `#f5f5f2`
- Surface: `#ffffff`
- Subtle surface: `#f9f9f7`
- Paper: `#ffffff`
- Ink: `#161713`
- Ink soft: `#3f423b`
- Muted: `#777c72`
- Muted strong: `#5d6259`
- Border: `#e2e4de`
- Strong border: `#cdd1c8`
- Primary: `#2f55e7`
- Primary hover: `#1f42c8`
- Primary soft: `#edf1ff`
- Success: `#187453`
- Warning: `#91600a`
- Error: `#b13a30`

No additional decorative accent colors.

## Typography
UI stack:
`ui-sans-serif, -apple-system, BlinkMacSystemFont, Pretendard, Noto Sans KR, Apple SD Gothic Neo, Segoe UI, sans-serif`

Manuscript stack:
`Iowan Old Style, Noto Serif KR, Source Han Serif K, Georgia, serif`

Rules:
- application page H1: 44–68px desktop, 36–48px mobile
- H2: 22–30px
- UI body: 13–16px
- labels: 9–12px only when secondary
- manuscript: ~16–17px with 1.82–1.92 line-height
- avoid huge multiline marketing headlines inside the authenticated product
- long copy max width ~54–68ch

## Spacing
4px-derived scale:
`4 / 8 / 12 / 16 / 20 / 24 / 30 / 40 / 48 / 64 / 88`

Large whitespace is reserved for real information hierarchy, not decoration.

## Radius and depth
- compact control: 8–9px
- major work surface: 11–14px
- mobile bottom sheet: 18px top radius
- manuscript page: nearly square
- bottom control dock: 15px

Ordinary sections use borders or whitespace. Shadow is reserved for:
1. physical manuscript paper
2. floating mobile sheets/docks
3. rare active overlays

## Global application shell
### Desktop
- 224px quiet light navigation rail
- content max ~1160–1180px
- active item uses white surface + cobalt text, not a dark inverse block

### Mobile
- sticky 58px product header with compact brand and New Book action
- persistent 64px bottom navigation for Library / Create / Workflow
- safe-area aware
- no page begins without product identity

## Dashboard
The dashboard is an operational library, not a landing page.

Priority:
1. concise page title
2. one primary New Book action
3. compact counts
4. recent project list
5. generation progress/status

Do not use giant promotional hero copy inside the authenticated library.

## Creation wizard
The wizard shares the same light product shell and typography.

Desktop:
- compact step rail
- one dominant white work surface
- sticky actions

Mobile:
- horizontal step navigation
- one-column forms
- bottom app navigation remains reachable
- primary action never hidden behind browser chrome/safe-area

## Manuscript editor
### Desktop
Three work zones remain because they map to real tasks:
- outline: ~254px
- manuscript: flexible center
- AI/production inspector: ~316px

All three zones use the same neutral product language. The outline is no longer a black visual wall.

### Mobile — manuscript first
This is the key v2 change.

The desktop rail layout must **never** be stacked top-to-bottom on a phone.

Default mobile viewport shows:
1. compact editor header
2. current Section title + save state
3. manuscript paper immediately
4. fixed bottom editor dock

Bottom dock:
- Outline
- Manuscript (current)
- AI / Tools

Outline and AI open as bottom Sheets above the manuscript with a scrim and explicit close controls. Selecting a Section closes the outline sheet and returns directly to the manuscript.

This prevents navigation chrome from consuming the first screen and makes the writing surface the primary product experience.

## States and interaction
Every interactive control needs:
- default
- hover
- focus-visible
- active/selected
- disabled
- loading where applicable

System states:
- saved
- saving
- local draft
- recovered draft
- server error
- generation running
- waiting for provider limit
- reconnect needed
- completed

Generation animation must stop under `prefers-reduced-motion`.

## Accessibility
- semantic landmarks
- visible focus rings
- minimum practical touch target ~40–44px
- labels for form fields
- `aria-current` for navigation/current manuscript
- `aria-controls` + `aria-expanded` for mobile Sheets
- scrim has an accessible close label
- errors announced with alert/live regions where appropriate
- reduced motion respected

## Responsive QA checklist
Test around:
- 320px
- 360–390px Android/iPhone widths
- 768px tablet
- 900px transition
- 1180–1440px desktop

Reject if:
- horizontal overflow appears
- manuscript begins below a large navigation/outline block
- bottom navigation obscures actions
- titles wrap into visually dominant poster-like blocks
- helper text drops below comfortable contrast
- a desktop rail simply becomes a tall mobile section

## Anti-patterns
Do not reintroduce:
- dark console rail as the dominant mobile surface
- giant authenticated-page marketing headlines
- card/border around every section
- bento grids without information need
- glow, glass, purple gradient, decorative blobs
- meaningless badges
- repeated icon + title + paragraph feature cards
- tiny body text to fit dense controls
- shadcn default visual styling copied unchanged
- animation used as decoration
