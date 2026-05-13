# Design System Specification: Technical Sophistication

## 1. Overview & Creative North Star
**Creative North Star: "The Precise Architect"**

This design system is a tribute to the "IDE Aesthetic"—an environment where high information density meets extreme clarity. We are moving beyond the generic "Dark Mode" to create a workspace that feels like a precision instrument. The system avoids the "template" look by rejecting traditional card-based containers in favor of a monolithic, interlocking layout inspired by technical blueprints and high-end code editors.

The experience is defined by **intentional density**. We do not fear small text or complex layouts; instead, we master them through a rigorous adherence to tonal hierarchy and a "Swiss-Grid" approach to alignment. It is professional, undistracted, and authoritative.

---

## 2. Colors & Surface Logic

The palette is rooted in the "Darcula" philosophy: low-contrast backgrounds to reduce eye strain, punctuated by high-chroma functional accents.

### The "No-Line" Rule
Traditional UI relies on borders to separate ideas. In this system, we prohibit 1px solid borders for sectioning. Structural boundaries are defined by **background shifts**. Use `surface-container-low` against `surface` to denote a sidebar. Use `surface-container-high` to define a workspace. Lines are for data; surfaces are for structure.

### Surface Hierarchy & Nesting
Depth is achieved through "Tonal Stacking." Each level of nesting requires a shift in the surface token:
*   **Application Frame (Lowest):** `surface-container-lowest` (#0D0E11)
*   **Primary Workspace:** `surface` (#121316)
*   **Navigational Panels:** `surface-container-low` (#1A1B1E)
*   **Active Modals/Popovers:** `surface-container-highest` (#343538)

### Glass & Texture
While we avoid heavy gradients, use a **"Technical Glass"** effect for floating palettes (like Command Palettes or Tooltips). Use `surface-variant` at 80% opacity with a `20px` backdrop blur. This ensures that the dense data underneath remains visible as a blurred texture, maintaining the user's spatial awareness without cluttering the foreground.

---

## 3. Typography
We utilize a dual-font strategy to distinguish between "Interface" and "Content."

*   **UI/Interface (Inter):** Used for all navigation, buttons, and labels. Inter’s tall x-height ensures readability at small scales (`label-sm`).
*   **Data/Monospace (JetBrains Mono):** Used for all user-generated data, code snippets, IDs, and timestamps. This font is the "soul" of the system, providing a rhythmic, mechanical feel that signals "technical accuracy."

**Editorial Scale:**
*   **Display-LG:** Used sparingly for empty states or dashboard headers.
*   **Title-SM:** The workhorse for section headers.
*   **Body-MD:** The default for data entries, utilizing JetBrains Mono.

---

## 4. Elevation & Depth

We reject drop shadows in favor of **Tonal Layering**.

*   **The Layering Principle:** To "lift" an element, simply increment its surface token. An active tab should move from `surface-container-low` to `surface`.
*   **Ambient Shadows:** For floating elements (Modals), use a `0 12px 32px` shadow using a tinted version of `surface-container-lowest` at 40% opacity. It should feel like a soft occlusion, not a "glow."
*   **The "Ghost Border" Fallback:** Where extreme density requires a separator (e.g., table headers), use `outline-variant` (#424654) at 15% opacity. This creates a "hairline" effect that guides the eye without breaking the visual flow.

---

## 5. Components

### Buttons
*   **Primary:** `primary-container` background with `on-primary-container` text. High contrast, sharp (4px radius).
*   **Secondary:** `surface-container-high` background. No border. Subtle hover shift to `surface-bright`.
*   **Ghost:** Transparent background, `outline` text. Used for low-priority actions in dense toolbars.

### Input Fields
*   **Standard:** `surface-container-highest` background. No border. Use a 2px bottom-accent of `primary` only when focused.
*   **Validation:** Error states use `error` (#FFB4AB) for the label text and a subtle 5% `error_container` fill for the input background.

### Chips & Tags
*   **Action Chips:** Rectangular (2px radius). Use `secondary-container` for active states.
*   **Status Chips:** Use a "Dot + Label" pattern. A 6px circular dot of `secondary` (Green) or `tertiary` (Yellow) next to `label-md` text. Forbid the use of pill-shaped backgrounds for status.

### Cards & Lists
*   **The Divider Ban:** Do not use horizontal lines between list items. Use the `0.2rem` (1) spacing scale to create rhythmic gaps. If separation is needed, use alternating "Zebra" striping with `surface-container-low` and `surface`.

### Toolbars & Tooltips
*   **Toolbars:** Monolithic blocks of `surface-container-low`. Icons should be `on-surface-variant` (#C2C6D6), shifting to `on-surface` on hover.
*   **Tooltips:** Dark `surface-container-highest` with `label-sm` JetBrains Mono text. 0.5s delay to prevent visual noise.

---

## 6. Do’s and Don’ts

### Do
*   **DO** use JetBrains Mono for any value that can be calculated (numbers, dates, hex codes).
*   **DO** lean into high density. Use `spacing-1` and `spacing-2` (0.2rem - 0.4rem) for internal component padding.
*   **DO** use "Intentional Asymmetry." Align navigation to the left and utilities to the far right, leaving large technical gaps in the center to emphasize the "Workspace" feel.

### Don’t
*   **DON'T** use large border radii. Anything above `rounded-md` (0.375rem) will break the professional, architectural tone.
*   **DON'T** use 100% black. The "Darcula" feel relies on the soft charcoal of `surface` (#121316) to keep the UI from feeling "empty."
*   **DON'T** use icons without labels in primary navigation. Clarity precedes minimalism.