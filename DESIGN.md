# AI Book Studio — Editorial OS Design System

## Product category
AI-assisted publishing and long-form manuscript production software.

The product is not a book gallery and it is not a generic AI chat SaaS. It is an operating environment where an idea moves through blueprint, manuscript generation, revision, quality control and export.

## Target audience
- individual authors and first-time writers
- students creating structured long-form work
- solo creators and educators
- users who want AI assistance without losing control of manuscript structure, drafts and production state

## Visual direction
**Editorial Operating System**

The UI combines the clarity of professional production software with the calm visual hierarchy of contemporary editorial design. The manuscript is the visual protagonist. Application chrome is precise, quiet and operational.

The product deliberately avoids:
- purple/blue gradient SaaS styling
- glow and glassmorphism
- card-inside-card layouts
- decorative dashboard bento grids
- oversized empty hero sections
- rounded rectangles as the default container
- decorative badges and meaningless icon rows
- animation that does not explain state

## Design style
- premium and restrained
- contemporary editorial rather than literary nostalgia
- strong hierarchy through type, whitespace and rules
- one action accent, semantic colors only for state
- open surfaces before cards
- real paper depth only where physical-page metaphor matters

## Color system
### Core
- Canvas: `#f3f4f1`
- Surface: `#fbfcf9`
- Paper: `#ffffff`
- Ink: `#171914`
- Ink soft: `#343730`
- Muted text: `#70756b`
- Strong muted text: `#555b50`
- Border: `#d9ddd4`
- Strong border: `#bcc3b7`

### Brand/action
- Primary cobalt: `#2447d8`
- Primary hover: `#1736a6`
- Primary soft: `#edf1ff`

### Semantic
- Success: `#176b4d`
- Warning: `#8a5b05`
- Error: `#a83227`

### Navigation
- Graphite rail: `#171914`
- Elevated graphite: `#22251f`
- Rail divider: `#363a32`

No other accent colors should be introduced without a semantic reason.

## Typography
The product UI uses a durable Korean-capable system sans stack. This avoids font downloads, improves first paint and keeps the interface native-feeling across macOS, Windows, Android and iOS.

UI stack:
`ui-sans-serif, -apple-system, BlinkMacSystemFont, Pretendard, Noto Sans KR, Apple SD Gothic Neo, Segoe UI, sans-serif`

Manuscript stack:
`Iowan Old Style, Noto Serif KR, Source Han Serif K, Georgia, serif`

### Hierarchy
- Display: 48–85px depending on authentication/product statement context only
- Page H1: ~48–58px desktop, 37–43px mobile
- H2: 24–30px
- H3: 16px
- Body: 16px base
- Supporting UI body: 13–14px
- Labels/status: 10–12px only where hierarchy permits

Rules:
- body copy should not become tiny to fit more controls
- headings use tighter tracking, body copy does not
- long explanatory text targets roughly 60–70ch
- tabular numerals are used for progress and counts
- monospace is reserved for logs/code-like data only

## Spacing
Use a 4px-derived scale:
- 4
- 8
- 12
- 16
- 24
- 32
- 48
- 64
- 96

Section spacing is not mechanically identical. High-level page transitions use 48–96px, component interiors generally use 8–24px.

## Radius
Radius communicates role rather than decorating every surface:
- XS 5px: compact chips/suggestions
- SM 8px: buttons, inputs, navigation selections
- MD 12px: major work surfaces
- LG 18px: rare, only for large standalone surfaces

Paper pages keep near-square corners. Pills are reserved for true state labels.

## Shadow
Only two depth metaphors are intentional:
1. manuscript paper floating above the production canvas
2. persistent generation dock above working content

Ordinary panels use rules, tonal separation or whitespace instead of shadow.

## Grid and layout
### Global application shell
Desktop:
- 236px graphite navigation rail
- flexible content region
- max production content ~1240px

Tablet/mobile under ~900px:
- navigation becomes a fixed bottom navigation
- safe-area inset is respected
- content receives enough bottom padding to remain unobscured

### Dashboard
A production queue, not a cover-card gallery.
Each row prioritizes:
1. title and current state
2. recent activity
3. progress
4. small book identity marker

### Book creation
Desktop:
- compact persistent step rail
- one dominant work surface
- sticky completion controls

Mobile:
- horizontal sticky progress strip
- one-column controls
- primary navigation remains reachable above the bottom app navigation

### Editor
Desktop:
- outline: 252px
- manuscript: flexible center
- AI/production tools: 326px

The actual manuscript page remains the visual focus.

Tablet/mobile:
- outline becomes a compact, bounded section
- manuscript follows immediately
- production/AI tools follow in reading order
- no full-height side rail is forced onto a narrow viewport

## Component language
### Buttons
- one primary action per immediate decision area
- primary = cobalt
- secondary = neutral outline/open surface
- destructive = semantic error only when destructive
- 44–48px touch height where practical

### Inputs
- explicit labels
- visible hover and focus state
- 48px standard control height
- error text is announced and visually connected to the task

### Surfaces
Prefer:
- open layout
- section rules
- tonal background changes
- one strong work surface

Avoid wrapping every group in a card.

### Progress
Use factual linear progress with exact percentage and current work state. Progress rings are not used.

## UX patterns
### Background generation
The user must understand that work persists after navigation or browser close. Generation state therefore appears both in relevant project controls and as a persistent bottom dock while active.

### Draft safety
Local draft recovery and server autosave remain visually distinct states:
- saved
- saving
- local temporary draft
- recovered draft
- server error with local preservation

### Empty states
Empty states explain the next useful action rather than presenting decorative illustrations.

### Loading
Skeletons mimic the destination layout so users understand what is loading. Full-screen spinners are avoided for content-heavy pages.

### Error
Errors use semantic copy and a clear recovery route. Raw technical error strings should not dominate the page when a user-facing explanation is available.

## Interaction strategy
Motion is functional and restrained:
- progress interpolation
- small hover movement where it communicates clickability
- loading skeleton shimmer
- no repeated entrance choreography

`prefers-reduced-motion` collapses animation and transition duration.

## Responsive strategy
The product is designed from task priority, not by shrinking desktop pixels.

Key rules:
- no horizontal document UI overflow from 320px upward
- bottom app navigation uses `env(safe-area-inset-bottom)`
- touch targets remain usable
- tables/grids collapse into readable vertical structures
- side rails become bounded sections
- manuscript logical page size never changes; the page presentation scales instead

## Accessibility
Every interactive surface should pass these checks:
- semantic landmark and heading structure
- keyboard reachable controls
- visible `:focus-visible`
- form labels and autocomplete attributes
- `aria-live` for asynchronous generation/login/error state where appropriate
- no color-only communication for critical state
- meaningful `aria-current` in navigation
- skip-to-content link in the application shell
- reduced motion support
- sufficient foreground/background contrast

## Dependency philosophy
The current application is Next.js/React/TypeScript with plain CSS and no Tailwind/Radix layer. The redesign therefore does not add shadcn/ui, Magic UI or a motion dependency merely for appearance.

Patterns borrowed from those ecosystems—accessible control states, robust focus behavior, compositional hierarchy and restrained micro-interaction—are implemented within the existing stack. New dependencies should only be introduced when they improve accessibility or maintainability more than they increase architectural cost.

## Final critique checklist
Before shipping a UI change, ask:
1. Is the manuscript or primary task more obvious than the surrounding chrome?
2. Could any card/border be replaced by spacing or a rule?
3. Is there exactly one obvious primary action for the current decision?
4. Is supporting text readable, not merely compact?
5. Does mobile feel deliberately composed rather than stacked desktop?
6. Are loading, empty, success, warning and error states coherent?
7. Is the accent color communicating action/state rather than decoration?
8. Is focus visible and keyboard order logical?
9. Does any element look like a generic AI SaaS template convention?
10. Would removing an effect improve clarity? If yes, remove it.
