# AI Book Studio — Design System

## Direction: Pressroom
AI Book Studio should feel like a contemporary manuscript production console: the writing surface is quiet and legible, while navigation and production state feel precise and operational.

The interface explicitly refuses the default “book app” look of warm cream paper, decorative serif headlines, bookshelf card grids, and repeated editorial kickers. It also avoids the generic AI SaaS look of gradients, glow, glass, and nested rounded cards.

## Thesis
The product is not a gallery of books; it is a place where manuscripts move through production. Progress, current work, saved state, and the manuscript itself should be the most obvious things on screen.

## Palette
- Canvas: `#eef1f4`
- Surface: `#ffffff`
- Ink: `#12151b`
- Muted: `#616975`
- Production rail: `#11151d`
- Press blue / primary action: `#2f57d4`
- Success: `#16745a`
- Error: `#b42318`

Use a restrained strategy: neutrals plus one main blue accent. Success/error colors are semantic only.

## Typography
Use a durable UI sans stack for product surfaces. Hierarchy comes from weight, scale, measure, and spacing rather than a decorative display typeface. The manuscript textarea may use a reading serif because it represents book content rather than app chrome.

- Headings: strong weight, tight but never tighter than `-0.04em`.
- Body copy: comfortable 65–75ch measure where possible.
- Measurements/status data may use tabular numerals.
- Monospace is reserved for logs or code-like data, never as decoration.

## Layout grammar
### App shell
A dark production rail anchors desktop navigation. It becomes a compact horizontal header on smaller screens.

### Dashboard
Use a manuscript queue rather than equal-size book cards. Each row exposes title, last activity, generation progress, and status. Covers are compact identity markers, not the main content.

### Book creation
The seven-step flow uses a persistent production rail because order matters. The current task occupies one large work surface. Controls should never be scattered across multiple nested cards.

### Editor
Three responsibilities:
1. Left: outline and manuscript structure.
2. Center: manuscript and editing.
3. Right: AI generation, rewrite, version, quality, export.

The center paper is the visual focus. The side rails support it rather than compete with it.

### Live generation
Generation progress is a compact bottom production dock with percentage, section count, word count, and current section. It should feel like persistent system state, not a floating promo card.

## Components
- Primary buttons: press blue, 8px radius.
- Secondary buttons: neutral border, no decorative shadows.
- Cards are not the default container. Prefer rows, rules, open surfaces, and structural grouping.
- When a true card is needed, use one elevation mechanism: border or shadow, not both.
- Pills are reserved for small state indicators.
- Progress bars are linear and factual; no progress rings.

## Browser details
Selection, focus rings, textarea caret, scrollbars, disabled state, hover state, empty state, error state, and loading state are part of the design system and must remain themed.

## Motion
Use motion only to explain state changes. The current system uses restrained hover translation and smooth progress interpolation. Do not add repeated entrance animations or decorative motion to every section.

## Responsive rules
- Under ~900px, desktop rails become stacked sections or compact top navigation.
- The editor becomes outline → manuscript → AI tools in reading order.
- The manuscript remains comfortable to read with reduced paper padding.
- The generation dock stays visible and simplifies its information hierarchy on small screens.

## Anti-patterns
Do not introduce:
- eyebrow/kicker labels above page headings;
- purple/cyan gradients or gradient text;
- glassmorphism or decorative blur;
- cards nested inside cards;
- same-size icon/heading/text cards as page structure;
- decorative monospace labels;
- arbitrary rounded rectangles standing in for content;
- hard zero-blur offset shadows;
- book-category clichés as the entire visual identity.

## Finish rule
Every new surface must be checked for real content, keyboard focus, responsive composition, loading/error/empty states, readable contrast, and whether the primary user task is understandable within seconds.
