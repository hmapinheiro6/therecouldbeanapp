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
