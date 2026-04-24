# Multi-Select & Batch Operations Design

## 1. Overview
This feature introduces the ability to select multiple files/directories in the file browser (both Grid and List views) to perform batch operations. The design is optimized for mobile/touch devices while retaining simple desktop keyboard shortcuts.

## 2. Interaction Flow

### Entering "Selection Mode"
- **Desktop**: 
  - Holding `Ctrl` or `Cmd` while clicking an item immediately enters Selection Mode and selects that item.
- **Mobile/Touch**: 
  - The existing "Long Press" action currently opens the item's contextual menu.
  - We will add a new `Select` (多选) button to this contextual menu.
  - Tapping it will enter Selection Mode and select the target item.

### Behavior in "Selection Mode"
- **State**: The UI enters a global `isSelectionMode = true` state.
- **Click Behavior**: Clicking any item no longer opens the preview or navigates into the directory. Instead, clicking toggles its selected state (select/deselect).
- **Shift-Click**: Intentionally excluded (user requested simple point-and-click, minimizing complex desktop paradigms).
- **Exiting**: User can exit by clicking a `Cancel` (取消) button on the Floating Action Bar, or when the selected count reaches zero (optional, usually explicit cancel is better).

## 3. Visual Design

### Selected Item Feedback
When an item is selected, it will resemble the iOS Photos selection style:
- The inner container (image or icon area) scales down slightly (e.g., `scale-95`).
- A primary-colored border (e.g., `ring-2 ring-primary`) wraps the item.
- A circular checkmark icon (`CheckCircle` with a filled primary background) appears in the top-right corner.
- Unselected items in Selection Mode will show an empty circle placeholder in the top-right to indicate they can be tapped.

### Floating Action Bar (FAB)
When `isSelectionMode` is active, a floating bar slides up from the bottom (or down from the top).
- **Left**: `Cancel` button and a text indicating `N items selected`.
- **Right**: Action buttons:
  - `Select All` / `Deselect All`
  - `Download` (Only active if files are selected, directories are skipped for now)
  - `Delete` (Red icon)
- The bar should be styled with a blurred background (`backdrop-blur`) and rounded corners to look modern and native.

## 4. Architecture & State Management

### New React State
In `Browser.tsx`:
```typescript
const [isSelectionMode, setIsSelectionMode] = useState(false);
// Set of file paths that are currently selected
const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
```

### Modified Handlers
- `handleItemClick`:
  ```typescript
  if (isSelectionMode || e.metaKey || e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      if (!isSelectionMode) setIsSelectionMode(true);
      toggleSelection(file.path);
      return;
  }
  // Proceed to preview/navigate...
  ```
- Context Menu: Add the `Select` button.

### Batch API Integrations
- **Batch Delete**: Map over `selectedPaths`, call `deleteItem` for each, show a unified toast, and reload the directory once.
- **Batch Download**: Similar to the existing `handleDownload`, but iterate over selected files. We will need to decide if we prompt for a save directory once and download all files there automatically.
- **Rename**: Batch rename is complex and usually excluded from simple file managers. We will hide the Rename button in the batch action bar.

## 5. Ambiguity & Scope Check
- **Download Dialog**: Tauri's `save` dialog is for a single file. For batch downloads, we either need a `open` dialog to select a *directory* to save all files into, or rely on the `lastSaveDir`. We will use Tauri's `open({ directory: true })` API to ask the user "Where do you want to save these N files?" and loop through them.
- **Directory Download**: If a directory is selected, we currently cannot download it. We will filter out directories from the download queue or disable the Download button if a directory is selected.