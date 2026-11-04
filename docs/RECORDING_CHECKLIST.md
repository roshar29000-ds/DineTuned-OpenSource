# Three-minute demo recording checklist

Run the local FastAPI server and Next.js frontend, then use a 1280 × 720 (16:9) browser viewport and the offline [guided demo](http://localhost:3000/demo). All demo venues and menus are fictional. Do not narrate the replay as a fresh Muse Spark request. Start the frontend with `cd web && DINETUNED_TEST_KITCHEN_PREVIEW=true npm run dev` if you also need the capture-only routes.

1. `/` — show the welcome promise and the **Try DineTuned Demo** entry. Returning local profiles may redirect to Explore; the same entry is there.
2. `/demo` — press **Meet Taste Detective** for choice footage; optionally restart and press **Use a clearly labeled sample palate** for the complete replay.
3. Show Taste DNA, then **Find a restaurant**. The original Explore page has six distinct fictional restaurants. Choose Casa Sol for three dish-specific sample images and browse its 20 dishes across seven categories. Real Restaurants is a separate authenticated path.
4. Press **Find My Personal Picks**. Record the Culinary Orbit loading sequence using that menu's fixture dishes, without provider calls, or use `/culinary-orbit-preview?capture=1` for a clean, reproducible offline cinematic capture. `/culinary-orbit-preview` has replay and act controls. These preview routes require the localhost flag above.
5. Show the three photo-led sample Picks, expand **More about this pick** for TasteBridge and source limits, choose a table and show its exact selected subtotal, then select a refinement.
6. Choose/save a dish, mark it tried, rate it, open **Taste Memory**, and refresh to show the isolated demo record persists in the tab. Use `/demo` to begin the introductory journey again; real guest data remains separate.

For stills, use the current [Taste DNA](screenshots/demo-taste-dna.png), [original Explore](screenshots/demo-explore.png), [menu](screenshots/demo-menu.png), [menu prices](screenshots/demo-menu-items.png), [Test Kitchen](screenshots/demo-test-kitchen.png), [Picks](screenshots/demo-picks.png), and [Memory](screenshots/demo-memory.png) captures. The normal `/picks-preview` route is a separate, clearly labeled offline design preview. The authenticated real restaurant flow needs configured services and valid authorization; do not cut its footage together with sample results as if one live inference produced them.
