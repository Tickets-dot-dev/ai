---
name: tickets-dev
description: Use when a task needs live ticket listings, prices, fees, availability or seat maps from Ticketmaster, StubHub, SeatGeek, Vivid Seats, TickPick, Gametime, Viagogo or another ticket marketplace through Tickets.dev, including price comparisons and tracking availability over time. Covers the facts about ticket data that are easy to get wrong.
---

# Tickets.dev

The API reference is https://tickets.dev/openapi.json. Find the event first (free), then capture **one event on one marketplace** per call (billed with a live key). Take marketplace URLs from the event search or the user, never guess them.

## Facts that are easy to get wrong

- **A listing that disappears is not a sale.** It may have sold, been delisted or been repriced. Report "tickets listed fell from X to Y", never "X tickets sold".
- **Compare on `totalPrice`.** It's per ticket, all-in (fees included), before sales tax, and means the same on every marketplace. How `ticketPrice` and `fee` split it varies: marketplaces that show only an all-in price report `fee` as 0.
- **`sellableQuantities` decides what can be bought.** A listing of 4 that sells as "2,4" can't sell 3.
- **Capacity comes from the venue map.** With `includeVenueMaps=true`, `venueLayout.capacity` is the seat count of the marketplace's venue map, given where the map goes down to seats (on Ticketmaster and SeatGeek, for example). It's the map's seats, not what's on sale for a given show, so label any utilization figure an estimate and show the calculation.
- **Primary and resale differ.** Box-office availability and resale listing counts measure different things. Keep them separate.
- **The same seats can be listed on several marketplaces.** When section, row and seats match, show the price spread.

## Keys and cost

- Every call needs the user's Tickets.dev key in `TICKETS_DEV_KEY`. If it's missing, tell them to get one at https://tickets.dev/pricing, set it where their agent starts, and restart the agent. **Never ask them to paste a key into the chat.**
- Captures cost money. Before capturing many events, marketplaces or a schedule, work out the number of captures with the user.

Everything is read-only. Nothing can buy, hold or list tickets.
