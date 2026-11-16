# Blueprint × 8-bit design system

The visual addendum replaces the former warm editorial identity. The same system now covers homepage, search, archive filters, product dossiers, submission/verification, informational pages, empty/loading/error states, favicon, and social sharing artwork.

## Foundation

`src/styles/main.css` defines the shared palette: blueprint `#123B8A`, navy `#071D49`, line blue `#4778C7`, paper `#F0F3ED`, and cyan `#8DCEF0`. A quiet 32px construction grid sits behind framed drawing sheets. Navy forms and paper dossiers create readable surfaces within the dominant blue. Borders, dimension lines, corner registration marks, dashed guides, and restrained offset shadows establish the blueprint language.

Large headlines use **Press Start 2P**. Technical labels, metadata, controls, and annotations use **IBM Plex Mono**. Longer descriptions, forms, policy text, and feature evidence retain a readable sans-serif. Both fonts are self-hosted Latin WOFF2 files, totaling 27,220 bytes. Their OFL licenses are included in `public/fonts/`; no external font request or font service is required. Primary license sources: [Press Start 2P](https://github.com/google/fonts/blob/main/ofl/pressstart2p/OFL.txt), [IBM Plex](https://github.com/IBM/plex/blob/master/LICENSE.txt).

## Components and artwork

`src/components/PixelArt.tsx` contains original integer-grid SVG artwork: desktop computer, lightbulb, floppy disk, application window, and software construction crane. These are hand-authored vector shapes with crisp edges. The window also anchors the favicon. There are no purchased packs, raster-generation dependencies, or external illustration requests.

The homepage is a concept drawing with a dark input field and bracketed control. Product cards show the product name, official domain, source-checked functionality, and compact feature callouts. Match indicators use one/two/three filled blocks beside the explicit related/partial/strong labels; they are ordinal indicators, never percentages. The homepage's “probably 40” line is explicitly identified as a joke; the published count comes from D1.

Search results derive from the actual response, with distinct loading, connection-error, and empty states. Candidate-set limits remain visible. The theme does not turn uncertain capability evidence into a stronger claim.

## Behavior and accessibility

Buttons move by two pixels in discrete steps; real network loading uses a short stepped scan. All transitions and animations stop under `prefers-reduced-motion`. No fake progress delay, parallax, autoplay, or heavy effects are used. Focus outlines, labels, skip navigation, form validation, and semantic status/error messages remain functional. Decorative illustrations are hidden from assistive technology.

Route focus uses `preventScroll` to avoid a second scroll after navigation. Enter submits search, Shift+Enter inserts a line, and IME composition does not accidentally submit. Turnstile uses compact 150px rendering where the form cannot fit its normal 300px widget; the real provider challenge remains mandatory and server-verified.

The local automated suite checks desktop and 390px mobile search/navigation/form flows. Manual browser checks also covered the 320px layout, real compact Turnstile, the deployed dossiers, and live catalog counts. Body overflow was absent at the checked narrow breakpoint. Primary text color pairs exceed 4.5:1 contrast; calculations are recorded in `design-contrast.json`. The bot challenge was visibly rendered; no manual CAPTCHA interaction or protection bypass was performed during this redesign check.

Current production captures: `blueprint-preview.png`, `homepage-desktop.png`, `homepage-mobile.png`, `blueprint-submission.png`, and `blueprint-product.png`. The social PNG is a direct browser render of the project's original SVG drawing at 1200×630.

## Simplification, 16 November

Removed the top header/navigation, all heading eyebrows and figure/department annotations, card file numbers, generic verification badges, and the entire stamped closing manifesto. Useful navigation lives in the footer. Essential form labels and evidence/match labels remain. The blue grid, pixel typography, and computer illustration remain the visual identity. Recent additions have actual catalog dates and a short explanation of discovery. Current release screenshots are `simplified-homepage-desktop.jpg` and `simplified-homepage-mobile.jpg`.

## Interactive monitor, 16 November

The landing page’s first fold is now a full CRT-style monitor. The actual search form sits inside a recessed phosphor-green screen; the warm case, inset glass, vents, screws, power switch, and stand are native CSS geometry. The screen’s color tokens are scoped locally, so the blueprint identity continues throughout the catalog and evidence pages. Subtle scanlines sit behind content and never intercept input. The screen has a real caret, selectable text, responsive controls, and an ordinary semantic form.

Search helpers offer editable examples (never automatic submission), an expandable task-and-audience recipe, and a `/` focus shortcut that ignores editable fields, interactive controls, modifier keys, and IME composition. The physical power button cycles useful thoughts and one “42” easter egg without clearing or submitting an idea. It is a labelled keyboard-accessible button, with a polite status message. No sound, third-party assets, new requests, or persistent tracking are introduced.

Page entrances, dossier arrivals, example icons and button presses have brief finite motion. The monitor uses a static texture rather than a flickering CRT effect. Reduced-motion preferences disable animations and transitions, including hover translations. The desktop/mobile browser checks cover the original search/review/fallback flows plus helpers, keyboard interactions, the easter egg, reduced motion, and a 320px layout. The mobile textarea stays at 16px to avoid automatic focus zoom in Safari.

## Idle suggestions and a shorter prompt

The monitor input now has an 80px, two-line starting height and a visible 160-character budget. The same limit is enforced by the form, live search API, and saved-catalog search. Oversized shared queries receive a clear validation message.

While empty and unfocused, the screen types and erases four faint example ideas. This is a decorative, pointer-transparent overlay, hidden from assistive technology, with a separate static accessible example. It never changes the textarea value. Focus freezes a complete suggestion; entering text removes it. Timers stop in background tabs and for reduced-motion preferences, which show a full static suggestion. The examples remain editable through “Try an example”.

## Visual findings cards

Cards now have a publisher-image panel, a clear product identity/domain and a compact summary. When a social image is unavailable, the same space shows a restrained name/initial fallback; publisher icons use a contained logo treatment. Search results use horizontal rows on desktop and stack on narrow screens. Explore/home grids retain the image above the content. Images reserve their space to avoid layout shifts and are loaded only near the viewport.

Up to three verified capability tags remain visible. Match reasoning, missing evidence, source links and publisher metadata dates sit behind native keyboard-accessible details. Publisher descriptions are explicitly labelled and kept separate from verified findings. Identity-only products continue to explain that features await review. The image has no additional accessible label because the adjacent product identity already names the link. Hover movement respects reduced motion. See [collection, delivery and free-tier budgets](METADATA-PREVIEWS.md).
