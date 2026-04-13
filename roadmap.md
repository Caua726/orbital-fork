# Orbital Roadmap

## Current State

The project already has the foundations of a playable space strategy prototype:

- Procedural world generation with planets, stars, fog, resources, and research systems
- Camera controls, selection flows, ship commands, and auto-updating world state
- A HUD pass in progress with sidebar, resource bar, empire badge, credits bar, chat log, minimap, and debug menu
- Audio hooks for match-end feedback

The next steps should focus on turning the prototype into a complete, replayable match loop before expanding scope.

## Now

- [ ] Stabilize the new HUD layer and align naming between `minimapa.ts` and `minimap.ts`
- [ ] Connect HUD widgets to live game state instead of placeholder values
- [ ] Finish win/lose detection flow and present clear end-of-match UI
- [ ] Add a match setup screen for map size, AI count, and difficulty
- [ ] Tighten planet ownership feedback, ship routing feedback, and combat readability

## Next

- [ ] Improve AI so opponents expand, defend, and attack with consistent priorities
- [ ] Make fog of war a real strategic system for both player and AI
- [ ] Expand the economy loop with clearer planet roles and stronger trait-driven output
- [ ] Rework research into a visible branching tech tree with meaningful unlocks
- [ ] Add onboarding guidance so the current systems are understandable without prior context

## Later

- [ ] Replace prototype visuals with a consistent pixel-art direction
- [ ] Add ship, combat, construction, and UI animation polish
- [ ] Introduce save/load support and broader balance passes
- [ ] Add richer AI personalities and replayability modifiers
- [ ] Explore multiplayer architecture only after the single-player loop is solid

## Priorities

- Playable match loop before content scale
- Clear player feedback before visual polish
- Strong AI before multiplayer
- Consistent UI integration before adding more screens
