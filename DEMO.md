# Demo path · UC2 Profitability Tracking (10 minutes)

The path covers the two BCG MVP priorities first: period-based PO cost and ingredient cost flowing through recipes. Loss and the Fresh Report follow.

**Before you start**
- Open the deployed URL and enter the password **BC2demo**.
- Use a laptop screen at 1440 px or wider. Start from a fresh tab, so the filters are at their defaults.
- Every link below is a query string you can paste after the site address (for example `https://<site>/?tab=itemcost`). **Reset filters** brings any view back to its defaults.

All data is simulated; say so once at the start. The date in the app is **10/18/2026 (FY2026 W43)**.

| Time | Tab | What to click | Story it shows |
|---|---|---|---|
| 0:00 | **Category-Item Summary** (`?tab=items`) | Point at the tiles and the Gross Margin Rate by week chart. Flip **Cost source: PO (real-time) → HQ (current)**; the change in points shows next to the switch. | Margins on the cost in HQ look better than reality. |
| 1:00 | Category-Item Summary | Set **Department = Seafood**. Read the **Cost pressure** banner. Click **Show Seafood since P8**. | Shrimp squeeze: cost up about 20 % since P8 with retail flat; Seafood margin 35.7 % vs 38.1 % last year. |
| 2:00 | **Item Cost Over Time** (`?tab=itemcost`) | It opens on **Roma tomatoes**, rolling 26 weeks. Hover W35 and W36 in the chart. Switch **Cost period: Week → Fiscal period**. Scroll to the purchase order lines. | Roma 25 lb case: $19.95 normally, **$4.95 glut in W35**, **$44.95 spike in W36**, back by W39. HQ holds $19.45 (dashed line). Period-based PO cost = PO spend ÷ volume purchased; in Fiscal period view P9 blends the glut and the spike. |
| 3:15 | Item Cost Over Time | Click **Simulate cost change**. Type a new cost, close with Esc. | Read-only what-if. A cost increase reads as "Annual cost change +$X" and "Margin impact −$X" in red. |
| 3:45 | **Ingredients View** (`?tab=ingredients`) | It opens on **16 in. Pepperoni Pizza**. Show the stacked bars, then the ingredient table (12 oz mozzarella, 1.25 lb dough ball, …) and the totals block. | Each ingredient's contribution to unit cost by week; Gross Profit on Gross Sales. |
| 4:45 | Ingredients View › **Where used** | Ingredient = **Pizza dough ball** (13 PLUs). Type **0.85** in *New cost per lb* (today $0.70). Click **16 in. Cheese Pizza** in the list. | A base ingredient change flows to every recipe: **annual cost change +$439K, margin impact −$439K**, Gross Profit % before and after per PLU. "Simulation only. Nothing is saved or sent to HQ." |
| 6:00 | **Cost Watch** (`?tab=cost`) | **PO vs HQ cost** (HQ = Retalix HQ, Weis's back-office system) is first: point at **Pie Pumpkins** on top. Open **Columns → Gap explained** to show *of which freight*. | Pumpkins: $150 per bin in HQ vs $250 on POs in season. Freight explains part of most gaps (HQ excludes it). About a quarter of items cost less than HQ (end of season, falling commodities). |
| 6:45 | Cost Watch › **Recipe PLUs** | Point at **16 in. Pepperoni Pizza** on top (last costed 03/2025, −8.3 pts). Click its arrow to open it in the Ingredients View. | Recipe costs typed from Excel go stale: about 60 % are older than 6 months. Today's ingredients make the pizza cost $5.66 vs $4.85 in HQ. |
| 7:30 | **Known Loss Report** (`?tab=loss`) | Point at the **Scope TBD** chip and strip first. Then type **24169** (Chicken Noodle Soup 16 oz) in the store table's SKU / PLU box. Store **116** is on top. Click **Report to IT** on that row, then **Export list for IT (CSV)**. | Store 116 sold 1 unit and scanned out 4,000 in W40: a likely entry error. The export (item, store, week, units, $, reason) is the hand-off to IT. Scope note: this view may move to a separate use case or a later wave; the MVP focuses on item cost and ingredient costing, and the High Loss Flag remains a required KPI in Category-Item Summary. |
| 8:30 | Known Loss Report | Clear the SKU. Point at the **flagged entries** list (salmon, store 152, W38, $11,700) and the **strawberries** banner ($8.9M, excluded from totals). | High Loss Flag = loss above $1,000 in a week (threshold basis assumed at cost, pending validation). |
| 9:15 | **Fresh Report** (`?tab=fresh`) | Read the **Below budget** banner and click **Show store**. | Store 154 Meat is about 7 pts below budget over the last 4 weeks, with DSD purchases at 9 % of sales. |
| 9:45 | Header › **KPI definitions** | Scroll to the end. | The workbook's open questions: Fresh Gross Sales source, Biceps access, the high-loss threshold and its basis, C&S tracking, PO Cost / Unit vs Purchase Cost per Unit. |

## If you have more time

- **Category-Item Summary:**
  - Open **Columns → Loss focus** to see loss without scrolling sideways.
  - Click an item row to see its stores.
- **Known Loss Report** (scope TBD): expand **New items watch** for FY2026 launches in their first 12 weeks.
- **Category-Item Summary:** filter **Department = Bakery** and look at **Total Purchases** for bread items: the chip says **DSD receipt (HQ)**. Bread is delivered straight to stores and recorded in Retalix HQ, and it adds up to the Bakery DSD line in the Fresh Report.
- **Fresh Report:** switch **View by → Fiscal Calendar → Day** to see daily gross profit swing with delivery days.

## If something looks off

- **A view looks filtered:** click **Reset filters**.
- **The password page shows again:** the session ended. Enter BC2demo again; the filters in the URL are kept.
