# Demo path · UC2 Profitability Tracking (10 minutes)

The path follows the tab order agreed after the prototype review: each tab answers a pain point from requirements collection, starting with real-time cost for commoditized items. Every view's heading says which pain point it addresses and what is still to validate; read that line first.

**Before you start**
- Open the deployed URL and enter the password **BC2demo**.
- Use a laptop screen at 1440 px or wider. Start from a fresh tab, so the filters are at their defaults.
- Every link below is a query string you can paste after the site address (for example `https://<site>/?tab=itemcost`). **Reset filters** brings any view back to its defaults.

All data is simulated; say so once at the start. The date in the app is **10/18/2026 (FY2026 W43)**. Chart axes show the week-beginning date.

| Time | Tab | What to click | Story it shows |
|---|---|---|---|
| 0:00 | **Item Cost Over Time** (opens first) | It opens on **Roma tomatoes**, rolling 26 weeks. Read the three costs: **HQ Average Cost**, **Historical PO Cost** (weighted average for the period) and **Real-time PO Cost**, with the Gross Margin Rate at each. Hover **08/23/26** and **08/30/26** in the chart. | Pain point: no cost trend for commoditized items; the HQ Average Cost is an end-of-day blend per SKU. Roma 25 lb case: $19.95 normally, **$4.95 glut in the week of 08/23/26**, **$44.95 spike the week of 08/30/26**, back by 09/20/26. HQ holds $19.45 (dashed line). |
| 1:15 | Item Cost Over Time | Switch **Cost period: Week → Fiscal period**. Then type **Pie Pumpkins** in the SKU / PLU picker. | Period-based PO cost = PO spend ÷ volume purchased (BCG proposal); P9 blends the glut and the spike. Pumpkins: $150 per bin in HQ vs $250 on POs in season, the largest gap of any item; out of season nothing is bought, so those periods are gaps. |
| 2:15 | Item Cost Over Time | Click **Simulate cost change**. Type a new cost, close with Esc. | Read-only what-if. A cost increase reads as "Annual cost change +$X" and "Margin impact −$X" in red. |
| 2:45 | **Category-Item Summary** (`?tab=items`) | Point at the tiles and the Gross Margin Rate by week chart. Flip **Cost source: PO (real-time) → HQ average**; the change in points shows next to the switch. | Both costs side by side: the HQ Average Cost the business uses today and the PO cost week by week. Which one is the default is a business decision (open questions 3 and 32). |
| 3:30 | Category-Item Summary | Set **Department = Seafood** and read the **Cost pressure** banner. Then set **Department = Deli** and read the **Stale costs** banner. | Shrimp: cost up about 20 % since P8 with retail flat. Recipe costs typed from Excel go stale: about 60 % are older than 6 months. |
| 4:30 | **Fresh Report** (`?tab=fresh`) | Read the **Below budget** banner and click **Show store**. Point at **Districts vs budget** and its **Top first / Bottom first** switch. | Store 154 Meat is about 7 pts below budget over the last 4 weeks, with DSD purchases at 9 % of sales. Total Purchases sits before Gross Margin, since gross profit here is sales minus purchases. The report is weekly: it is ready on Thursdays, once accounting postings are complete. |
| 5:30 | **Ingredients View** (`?tab=ingredients`) | It opens on **16 in. Pepperoni Pizza**. Show the stacked bars, the ingredient table (12 oz mozzarella, 1.25 lb dough ball, …) and the totals. | Pain point: no clear cost analytics for ingredient-based items. Last costed 03/2025 at $4.85; today's ingredients make it $5.66, about 8 pts of margin. |
| 6:30 | Ingredients View › **Where used** | Ingredient = **Pizza dough ball** (13 PLUs). Type **0.85** in *New cost per lb* (today $0.70). Click **16 in. Cheese Pizza** in the list. | A base ingredient change flows to every recipe: **annual cost change +$439K, margin impact −$439K**. "Simulation only. Nothing is saved or sent to HQ." |
| 7:30 | **Known Loss Report** (`?tab=loss`) | Point at the **Scope TBD** chip and strip. It opens on the **last full week** (10/11/26). Switch **View by → To Date → Year-to-Date**. Type **24169** (Chicken Noodle Soup 16 oz) in the store table's SKU / PLU box. Click **Add to IT Review List** on store **116**, then **Export list for IT (CSV)**. | Directors and CMs read it by last full week. Store 116 sold 1 unit and scanned out 4,000 in the week of 09/27/26: a likely entry error, handed to IT as a file. This view may move to a separate use case (open question 9), and KL1011 vs Ops 300 as the source of truth blocks the build (open question 16); the High Loss Flag stays required in Category-Item Summary. |
| 8:45 | Known Loss Report | Clear the SKU. Point at the **flagged entries** list (salmon, store 152, $11,700) and the **strawberries** banner ($8.9M, excluded from totals). | High Loss Flag = loss above $1,000 in a week (threshold basis assumed at cost, pending validation). |
| 9:30 | Header › **KPI definitions** | Scroll to the end. | The open questions the prototype cites, with their workbook numbers: Biceps access (#1), the $1,000 threshold (#2) and its SQL (#26), the Fresh purchases build (#5), recipe maintenance (#10), the loss source of truth (#16), among others. |

## If you have more time

- **Category-Item Summary:**
  - Open **Columns → Loss focus** to see loss without scrolling sideways.
  - Click an item row to open its store-level loss in the Known Loss Report.
- **Known Loss Report** (scope TBD): expand **New items watch** for FY2026 launches in their first 12 weeks.
- **Category-Item Summary:** filter **Department = Bakery** and look at **Total Purchases** for bread items: the chip says **DSD receipt (HQ)**. Bread is delivered straight to stores and recorded in Retalix HQ, and it adds up to the Bakery DSD line in the Fresh Report.

## If something looks off

- **A view looks filtered:** click **Reset filters**.
- **The password page shows again:** the session ended. Enter BC2demo again; the filters in the URL are kept.
