# BuildTek — project notes

## Temporarily hidden: AI plan-reading buttons

The AI extraction trigger buttons are **commented out in the UI** (not deleted) to
prevent accidental API charges while the AI model is being trained. Re-enable by
removing the `{/* AI extraction temporarily disabled … */}` comment wrappers once
the model is ready.

Hidden buttons:

| File | Button | onClick handler |
|------|--------|-----------------|
| `frontend/src/components/Sketch.jsx` | ✨ Read Floor Plan | `runAiExtract` |
| `frontend/src/components/Sketch.jsx` | ✨ Place Openings | `runOpeningsExtract` |
| `frontend/src/components/RoofSketch.jsx` | ✨ Extract from PDF | `onExtract` |

All underlying code is intact and untouched — handlers (`runAiExtract`,
`runOpeningsExtract`, `onExtract`), confirmation modals, extraction state, the
`aiFloorPlanExtractor.js` / `aiRoofExtractor.js` modules, and the backend routes.
Re-enabling is purely a matter of uncommenting the button JSX.

Still visible (intentionally kept): the admin-only **💾 Save Example** training-data
button in `Sketch.jsx`.
