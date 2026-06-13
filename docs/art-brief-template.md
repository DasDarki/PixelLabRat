# Art brief

Fill this in and paste it into Claude Code (with the `pixellabrat` MCP server
available). Claude will create the project, set its style contract, and start
working through the asset list. Delete the example column once you've written
your own.

```
Project name:        <e.g. Mossgrove>
Game / context:      <one line — genre, mood, what it's for>

Style description:   <the single most important field. Be specific and visual.
                      e.g. "soft warm 32x32 pixel art, limited pastel palette,
                      gentle 1px outlines, cozy storybook feel">
Perspective:         <side / low top-down / high top-down>
Default size:        <e.g. 32x32, 64x64>
Transparent bg:      <yes / no>
Reference images:    <optional: paths to PNGs to match, or "none yet">

Asset list:
  Characters:        <e.g. farmer (8-dir, + walking anim), shopkeeper>
  Objects:           <e.g. wooden well, fence post, watering can>
  Tilesets:          <e.g. grass/water (top-down)>
  UI:                <e.g. wooden button, heart health bar, inventory panel>
  Other:             <e.g. a few isometric ground tiles>

Notes / constraints: <budget, palette rules, things to avoid, etc.>
```

## How Claude should use it

1. Create the project and apply the style (description, perspective, size,
   transparency).
2. Generate **one** asset first as a style check; confirm the look before doing
   the rest.
3. Once a result is approved, promote it to a style reference so the remaining
   assets match it more tightly.
4. Work through the list, pausing for approval on the expensive items
   (characters, tilesets).
5. Keep an eye on the generation budget and call out roughly what each batch will
   cost before running it.

## Filled example

```
Project name:        Mossgrove
Game / context:      Cozy top-down farming sim, wholesome and warm.

Style description:   soft warm 32x32 pixel art, limited pastel palette, gentle
                     1px outlines, cozy storybook feel, no harsh contrast
Perspective:         high top-down
Default size:        32x32
Transparent bg:      yes
Reference images:    none yet

Asset list:
  Characters:        farmer in dungarees (8-dir, + walking and watering anims)
  Objects:           wooden well, fence post, watering can, wooden crate
  Tilesets:          grass / pond water (top-down)
  UI:                wooden button, heart health bar, inventory slot panel
  Other:             a couple of isometric dirt-path tiles for a menu background

Notes / constraints: keep the palette tight (8-10 colours); avoid pure black.
```
