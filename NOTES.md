# Playtest notes (not fixed yet)

1. Marseille to Barcelona on the PLM could not be taken (17 Nov 2026).
   Not caused by ownership: the engine never blocks an owned rail, it only charges for it. Cause: Marseille-Barcelona (3 dots, PLM) and Marseille-Toulouse (3 dots, MIDI)
   leave Marseille along the same stretch, so their first clickable pips are only 5 px apart and the Toulouse pip sits on top of the Barcelona one.
   Planner check with PLM owned by another player: Fastest and Balanced go Marseille-Barcelona; "Fewest fees" goes via Toulouse.
   Ideas: fan out pips that are closer than about 20 px; label each pip with its destination and rail; a small chooser when pips overlap;
   let a click on a track force that hop. Also: a city picked as a waypoint should be reached by the fastest way, not the fee-avoiding one.

2. No autozoom (18 Nov 2026): "follow" now defaults to off (settings key bumped to v2 so the old saved "on" is dropped). The train still flashes at the start of a turn; tick "follow" to bring the camera moves back.
3. Rail prices raised and spread by region (18 Nov 2026): see DESIGN-FRAMEWORK.md section 16. The old prices are in Boxcars/geo/price_override_before_regional.tsv.
