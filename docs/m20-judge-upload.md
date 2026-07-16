# M20 — Judge Data-Upload Panel

The **Judge Data-Upload Panel** provides evaluators and judges with a dedicated workspace on the Live Operations Dashboard to paste custom JSON data or select a `.json` file, demonstrating StadiumIQ's live responsiveness to external operational inputs.

---

## 1. UI Placement & Layout Grid

- **Location**: Mounted inside the three-column bottom panel layout of the **Organizer Live Ops Dashboard** (`Dashboard.tsx`), sitting alongside the **Dispatch Operations Queue** and the **God Mode Scenario Simulator**.
- **Layout Styling**: Enclosed inside a slate-bordered container (`min-h-[220px]`) featuring an interactive file upload zone, query textarea, schema format guidelines, and a reset toggle.

---

## 2. UploadDataset Schema Mapping

The uploaded JSON parses into an `UploadDataset` schema which maps directly onto the Zustand store's `importDataset()` state action:
- **`density`**: Maps a record of `zoneId -> density` (numbers in `[0, 1]`) to alter crowd-density heatmaps live on the `<StadiumMap>`.
- **`gateStatus`**: Maps a record of `gateId -> status` (`'open' | 'congested' | 'closed'`) to affect route calculation parameters.
- **`incidents`**: Feeds an array of new incident dispatches directly to the `DispatchQueue` and the map overlays.

---

## 3. Strict Validation Rules

To prevent code injection, schema pollution, and out-of-bounds metrics, the panel processes all inputs through a strict, pure deterministic validation checker in `uploadDataset.ts`:
1. **Size Limit Check**: Raw payload strings are capped at **200,000 characters** (~200KB). Any files or pasted text exceeding this threshold are immediately rejected *before* parsing, returning a size error.
2. **Key/Property Verification**: Restricts top-level keys to only `density`, `gateStatus`, and `incidents`. Rejects payloads containing arbitrary property names.
3. **Real Zone ID Checking**: Cross-references every key in `density` and `gateStatus` (and `zoneId` inside the `incidents` list) against MetLife Stadium's F2 venue graph (`ZONES`). Any reference to a nonexistent zone is flagged immediately.
4. **Boundary Checks**: Ensures density floats reside strictly in the range `[0, 1]`, and gate statuses strictly match `'open' | 'congested' | 'closed'`.
5. **Incident Format Verification**: Checks that incident objects possess non-empty IDs, notes, valid triage categories, non-negative creation timestamps, and valid status fields.
6. **Detailed Error Reporting**: Reports all schema compilation errors in a scrollable warning box in the UI, allowing builders to locate formatting issues.

---

## 4. Hook Reuse

- **`importDataset(dataset)`**: Pasted JSON or read files that pass validation are dispatched directly to the store action, which applies the scenario patch and fires an `IMPORT` message across the BroadcastChannel sync pipeline.
- **`reset(zones)`**: Reset triggers clear the imported mock dataset, reload the initial venue timeline, and restore default open gate attributes.
