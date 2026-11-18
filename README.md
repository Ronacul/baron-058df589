# Baron playtest (Eurobaron)

A playable, single-page version of the Eurobaron map for play-testing against bots and with friends on one device.
Static files only, no build step. Open `index.html` through a web server (the `jamb` entry in `../../.claude/launch.json`
serves `public/` on port 8787: http://localhost:8787/baron/index.html).

Files
- `data-eurobaron.js` - the map as data (generated, do not edit by hand).
- `engine.js` - the rules, no DOM. `Baron(MAP)` returns `newGame`, `rollRegion/pickRegion/rollCity`, `setRoute`, `rollMove`, `buyRail`, `buyChief`, `endTurn`, `botAct`, `stats`, `exportLog`.
- `app.js` - the page: map drawing, panels, bots on a timer, saves.
- `index.html` - layout and styles.

The map data (`window.BARON_MAPS.EU`)
- `tracker`: same shape as the Rail Baron tracker (`live/public/data.js`): `cities` (names), `m` (payoff matrix in dots, row by row), `regions` (`odd`/`even` -> roll 2-12 -> region),
  `cityTables` (region -> `odd`/`even` -> roll 2-12 -> city). Eurobaron's `m` is the shortest track route in dots; payoff = dots x `unit` (1000).
- `cfg`: start cash, win cash, Super Chief cost and dice, fees (public 1K, private 5K, 10K once all rails are sold), `meanPay` (the bot's cash reserve).
- `regions`, `land` (SVG path per country, region index or -1), `cities` (x, y, label position), `rails` (code, name, price in $K, line style, routes, `traf` = share of trips that use it,
  `imp` = extra dots per trip if its exclusive track were closed), `hops` (city to city segment: dots, rails on it, polyline `pts` where the third number marks a dot).

Rules as played (assumptions marked in the Rules dialog): destination by odd/even + 2 dice then city roll; rolling your own region lets you pick the region;
2 dice of dots a turn, 3 with the Super Chief; fees once a turn per payee; own rails free; rails and the Super Chief can be bought at every arrival;
win = reach the win cash at an arrival, then reach home; short of cash = rails sold to the bank at half price.

The bot is the same policy as `Boxcars/geo/sim.pl`: balanced route, buys by (trip share + bottleneck value) / price^0.6, skips rails scoring below 70% of the best open one, keeps one mean trip in reserve.
The engine matches the simulator: 20 bot-only games of 3 gave 34.5 rounds, 48 trips and 617 pips (sim: 34.5, 49, 607).

Saves: autosave in the browser (`baron.eu.save.v1`), "Save file" downloads the whole game, "Export game log" at the end writes every trip as JSON (player, from, to, pays, round) plus final stats and rail owners,
ready to feed the tracker.

Regenerate the data after changing the map: in `Boxcars/geo` run `perl eb_check.pl` then `perl eb_map2.pl` (it writes `../../yamb/public/baron/data-eurobaron.js`).
To build another map: write its `cities.tsv` and network file, set the region selector in `eb_check.pl`/`eb_map2.pl`, and add a second data file that defines `window.BARON_MAPS.<ID>`; `app.js` currently loads `EU`.

Not done yet: online play between devices (the Rail Baron tracker backend could carry the game JSON), undo, rules confirmation from the real rule book, a second map.

Update (route picking, track info, turn intro)
- Pick your path: during the route phase click cities on the map to add waypoints (dashed rings; click again or use the chips to remove). The engine takes the shortest way between waypoints using the chosen mode (fastest / balanced / fewest fees). `p.via` holds the waypoints; `toggleVia`, `clearVia`, `setRoute`.
- Click any track (or its code tag, or a row in the rail list) to highlight the whole rail and open a card with its name, price, owner or public, fee, the cities it serves, and a Buy button when you can buy it. Click a city to see the rails there. "rail codes" in the toolbar shows or hides the code tags (positions come from the map generator, on stretches where a rail runs alone).
- Start of each turn: the view eases out to the whole map, the player's train flashes with a ring, then the view glides in on it. Panning or zooming cancels it; "follow" in the toolbar turns the camera moves off. Bots wait for the intro unless the speed is set to fast.

Update (click each pip, destinations and homes)
- Click each pip: with "click each pip" ticked (default), "Roll to move" rolls the dice and then you move one dot at a time by clicking the pulsing circles on the map, counting the roll down. At a city every outgoing track offers a pip; mid-track the next pip is the only choice. Yellow marks the pip on your planned route. "Undo a pip" steps back, "Fill the rest along the route" uses the plan, "Finish move" pays the fees (once per turn per payee) and ends the move. Reaching the destination stops the move and collects the payoff. Untick the box to go back to the automatic move along the planned route.
  Engine: `rollMoveStep`, `stepOptions`, `stepWalk`, `undoWalk`, `autoWalk`, `walkFees`, `commitWalk` (a random-walk stress test of 6 games, with undo and auto-fill, ran clean).
- Every player's destination is always shown as a ring with the player's letter; every home city has a triangle in the player's colour (toolbar box "home triangles" turns the triangles on and off).
