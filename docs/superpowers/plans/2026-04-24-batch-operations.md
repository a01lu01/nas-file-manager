# Multi-Select & Batch Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a mobile-friendly multi-selection mode in the file browser with batch delete and download capabilities.

**Architecture:** We will introduce a global selection state in the `Browser` component. Entering selection mode (via Ctrl/Cmd+Click or long-press menu) transforms the item click behavior from "open" to "toggle selection". A Floating Action Bar (FAB) will appear to provide batch operations (Select All, Download, Delete).

**Tech Stack:** React, Tailwind CSS, Lucide Icons, Tauri API

---

### Task 1: Add Selection State and Toggle Logic

**Files:**
- Modify: `src/pages/Browser.tsx`

- [ ] **Step 1: Add selection state variables**
  Add `isSelectionMode` and `selectedPaths` to the `Browser` component.

```tsx
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
```

- [ ] **Step 2: Add selection toggle helpers**
  Add functions to toggle individual items, select all, and clear selection.

```tsx
  const toggleSelection = (path: string) => {
    setSelectedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
        if (next.size === 0) setIsSelectionMode(false);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedPaths(new Set());
    setIsSelectionMode(false);
  };

  const selectAll = () => {
    const allPaths = new Set(displayedFiles.map(f => f.path));
    setSelectedPaths(allPaths);
  };
```

- [ ] **Step 3: Modify `handleItemClick` to intercept clicks when in selection mode or when modifier keys are held**

```tsx
  const handleItemClick = async (e: React.MouseEvent, item: FileItem) => {
    if (isSelectionMode || e.metaKey || e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      if (!isSelectionMode) setIsSelectionMode(true);
      toggleSelection(item.path);
      return;
    }
    
    // ... existing preview/navigation logic ...
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/Browser.tsx
git commit -m "feat(browser): add multi-selection state and click interception logic"
```

### Task 2: Implement Visual Feedback for Selected Items

**Files:**
- Modify: `src/pages/Browser.tsx`

- [ ] **Step 1: Import `CheckCircle2` and `Circle` from lucide-react**

```tsx
import { /* existing imports */, CheckCircle2, Circle } from "lucide-react";
```

- [ ] **Step 2: Update Grid View item rendering**
  Wrap the inner content of the grid item to apply scaling and borders when selected, and add the selection indicator icon.

```tsx
// Inside displayedFiles.map for grid view:
const isSelected = selectedPaths.has(file.path);

return (
  <div
    key={file.path}
    onClick={(e) => handleItemClick(e, file)}
    onPointerDown={(e) => handleItemPointerDown(e, file)}
    onPointerUp={handleItemPointerUpOrLeave}
    onPointerCancel={handleItemPointerUpOrLeave}
    onPointerLeave={handleItemPointerUpOrLeave}
    className="group cursor-pointer flex flex-col items-center select-none relative"
  >
    <div className={`w-full aspect-square bg-surface rounded-lg overflow-hidden border transition-all relative mb-2 shadow-sm flex items-center justify-center ${
      isSelected ? "border-primary ring-2 ring-primary scale-95" : "border-transparent group-hover:border-primary/50"
    }`}>
      {/* ... existing thumbnail rendering ... */}
      
      {/* Selection Indicator */}
      {(isSelectionMode || isSelected) && (
        <div className="absolute top-1.5 right-1.5 z-20">
          {isSelected ? (
            <div className="bg-white rounded-full flex items-center justify-center shadow-sm">
               <CheckCircle2 size={20} className="text-primary fill-primary text-white" />
            </div>
          ) : (
            <div className="bg-black/20 rounded-full flex items-center justify-center backdrop-blur-sm border border-white/50">
               <Circle size={20} className="text-white/70" />
            </div>
          )}
        </div>
      )}
    </div>
    {/* ... existing text rendering ... */}
```

- [ ] **Step 3: Update List View item rendering**
  Apply similar visual feedback to list view items.

```tsx
// Inside displayedFiles.map for list view:
const isSelected = selectedPaths.has(file.path);

<div 
  key={idx}
  onClick={(e) => handleItemClick(e, file)}
  // ...
  className={`grid grid-cols-[auto_1fr_auto] md:grid-cols-[auto_1fr_120px_150px_40px] gap-4 px-3 py-2.5 rounded-lg cursor-pointer items-center group transition-colors border select-none ${
    isSelected ? "bg-primary/10 border-primary/50" : "hover:bg-surface border-transparent hover:border-border-standard"
  }`}
>
  {/* Add selection indicator at the very beginning of the row if in selection mode */}
  {isSelectionMode ? (
    <div className="flex items-center justify-center w-5 mr-2">
      {isSelected ? (
        <CheckCircle2 size={18} className="text-primary fill-primary text-white" />
      ) : (
        <Circle size={18} className="text-muted-foreground/50" />
      )}
    </div>
  ) : (
    <div className="text-muted-foreground group-hover:text-primary transition-colors">
      {file.is_dir ? <Folder size={18} fill="currentColor" fillOpacity={0.2} /> : <File size={18} />}
    </div>
  )}
  {/* ... existing columns ... */}
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/Browser.tsx
git commit -m "feat(browser): add visual selection feedback to grid and list items"
```

### Task 3: Add "Select" to Context Menu

**Files:**
- Modify: `src/pages/Browser.tsx`

- [ ] **Step 1: Add "Select" button to the item context menu**
  This allows touch users to enter selection mode without modifier keys.

```tsx
// Inside the openMenuPath === file.path block (for both grid and list views):
<div className="p-1 flex flex-col gap-0.5">
  <button
    onClick={(e) => {
      e.stopPropagation();
      setOpenMenuPath(null);
      setIsSelectionMode(true);
      toggleSelection(file.path);
    }}
    className="flex items-center gap-2 px-2 py-1.5 text-[13px] text-muted-foreground hover:text-foreground hover:bg-surface rounded-md transition-colors w-full text-left"
  >
    <CheckCircle2 size={14} />
    Select
  </button>
  {/* ... existing Rename, Download, Delete buttons ... */}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/Browser.tsx
git commit -m "feat(browser): add Select option to item context menu for touch devices"
```

### Task 4: Implement Floating Action Bar (FAB) for Batch Operations

**Files:**
- Modify: `src/pages/Browser.tsx`

- [ ] **Step 1: Create the FAB component markup**
  Render this at the bottom of the Browser component when `isSelectionMode` is true.

```tsx
// Near the end of the Browser component return, just before closing main divs:
{isSelectionMode && (
  <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-md z-50 animate-in slide-in-from-bottom-4 fade-in duration-200">
    <div className="bg-panel/90 backdrop-blur-xl border border-border-standard shadow-2xl rounded-2xl p-2 flex items-center justify-between">
      <div className="flex items-center gap-3 pl-2">
        <button 
          onClick={clearSelection}
          className="p-1.5 text-muted-foreground hover:text-foreground rounded-full hover:bg-surface transition-colors"
          title="Cancel"
        >
          <X size={18} />
        </button>
        <span className="text-[14px] font-medium text-foreground">
          {selectedPaths.size} selected
        </span>
      </div>
      
      <div className="flex items-center gap-1 pr-1">
        <button
          onClick={selectedPaths.size === displayedFiles.length ? clearSelection : selectAll}
          className="px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-surface rounded-lg transition-colors"
        >
          {selectedPaths.size === displayedFiles.length ? "Deselect All" : "Select All"}
        </button>
        
        <div className="w-[1px] h-4 bg-border-standard mx-1"></div>
        
        <button
          onClick={handleBatchDownload}
          disabled={!Array.from(selectedPaths).some(p => {
             const f = displayedFiles.find(df => df.path === p);
             return f && !f.is_dir;
          })}
          className="p-2 text-foreground hover:bg-surface rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Download Selected"
        >
          <Download size={18} />
        </button>
        
        <button
          onClick={() => setIsBatchDeleteOpen(true)}
          disabled={selectedPaths.size === 0}
          className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Delete Selected"
        >
          <Trash2 size={18} />
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/Browser.tsx
git commit -m "feat(browser): implement floating action bar for batch operations"
```

### Task 5: Implement Batch Delete Logic

**Files:**
- Modify: `src/pages/Browser.tsx`

- [ ] **Step 1: Add state for batch delete confirmation**

```tsx
  const [isBatchDeleteOpen, setIsBatchDeleteOpen] = useState(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
```

- [ ] **Step 2: Add `handleBatchDelete` function**

```tsx
  const handleBatchDelete = async () => {
    if (!activeConnection) return;
    setIsBatchDeleting(true);
    
    let successCount = 0;
    let failCount = 0;
    
    // Convert Set to Array to iterate
    const pathsToDelete = Array.from(selectedPaths);
    
    for (const path of pathsToDelete) {
      try {
        await deleteItem(activeConnection.id, path);
        successCount++;
      } catch (err) {
        console.error(`Failed to delete ${path}:`, err);
        failCount++;
      }
    }
    
    if (failCount === 0) {
      toast.success(`Successfully deleted ${successCount} items`);
    } else {
      toast.warning(`Deleted ${successCount} items, failed to delete ${failCount} items`);
    }
    
    setIsBatchDeleting(false);
    setIsBatchDeleteOpen(false);
    clearSelection();
    await loadDirectory(currentPath);
  };
```

- [ ] **Step 3: Add Batch Delete Confirmation Dialog**
  Add this to the JSX return, similar to the existing single delete dialog.

```tsx
{isBatchDeleteOpen && (
  <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={() => !isBatchDeleting && setIsBatchDeleteOpen(false)}>
    <div className="w-[380px] rounded-xl bg-panel border border-border-standard shadow-lg p-5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-start gap-3 text-destructive mb-3">
        <AlertCircle size={24} className="shrink-0 mt-0.5" />
        <div>
          <div className="text-[15px] font-[510] text-foreground mb-1">Delete {selectedPaths.size} items?</div>
          <div className="text-[13px] text-muted-foreground leading-relaxed">
            Are you sure you want to permanently delete {selectedPaths.size} selected items? This action cannot be undone.
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button
          onClick={() => setIsBatchDeleteOpen(false)}
          disabled={isBatchDeleting}
          className="px-4 py-2 text-[13px] font-medium text-foreground hover:bg-surface rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleBatchDelete}
          disabled={isBatchDeleting}
          className="px-4 py-2 text-[13px] font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-lg transition-colors flex items-center gap-2"
        >
          {isBatchDeleting && <Loader2 size={14} className="animate-spin" />}
          Delete All
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/Browser.tsx
git commit -m "feat(browser): implement batch delete logic and confirmation dialog"
```

### Task 6: Implement Batch Download Logic

**Files:**
- Modify: `src/pages/Browser.tsx`
- Modify: `src/lib/tauri-api.ts`

- [ ] **Step 1: Import `open` from `@tauri-apps/plugin-dialog`**
  In `Browser.tsx`, we need `open` to select a directory for batch saving.

```tsx
import { save, open } from "@tauri-apps/plugin-dialog";
```

- [ ] **Step 2: Add `handleBatchDownload` function**

```tsx
  const handleBatchDownload = async () => {
    if (!activeConnection) return;
    
    // Filter out directories, we only download files for now
    const filesToDownload = Array.from(selectedPaths).map(p => 
      displayedFiles.find(f => f.path === p)
    ).filter((f): f is FileItem => f !== undefined && !f.is_dir);
    
    if (filesToDownload.length === 0) {
      toast.info("No downloadable files selected");
      return;
    }
    
    try {
      // Ask user for a directory to save all files
      const selectedDir = await open({
        directory: true,
        multiple: false,
        defaultPath: lastSaveDir || undefined,
        title: "Select Directory to Save Files"
      });
      
      if (!selectedDir || typeof selectedDir !== 'string') return;
      
      setLastSaveDir(selectedDir);
      
      let startedCount = 0;
      
      for (const file of filesToDownload) {
        const targetPath = `${selectedDir.replace(/\/$/, "")}/${file.name}`;
        
        upsertTask({
          id: `${activeConnection.id}-${file.path}`,
          filename: file.name,
          connectionId: activeConnection.id,
          remotePath: file.path,
          localPath: targetPath,
          status: "pending",
          progress: 0,
          totalSize: file.size,
          downloadedSize: 0,
          type: "download",
        });
        
        startDownload(activeConnection.id, file.path, targetPath).catch(err => {
          console.error(`Failed to start download for ${file.name}:`, err);
        });
        
        startedCount++;
      }
      
      toast.success(`Started downloading ${startedCount} files`);
      clearSelection();
      
    } catch (err) {
      console.error("Batch download error:", err);
      toast.error("Failed to start batch download");
    }
  };
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/Browser.tsx
git commit -m "feat(browser): implement batch download logic with directory picker"
```

### Task 7: Disable Features Incompatible with Selection Mode

**Files:**
- Modify: `src/pages/Browser.tsx`

- [ ] **Step 1: Hide "New Folder" button when in selection mode**
  In the top action bar:

```tsx
{/* Replace the Plus/New Folder button with a conditional */}
{!isSelectionMode && (
  <button
    onClick={handleNewFolder}
    className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-surface rounded-md transition-colors"
    title="New Folder"
  >
    <FolderPlus size={18} />
  </button>
)}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/Browser.tsx
git commit -m "fix(browser): hide incompatible actions during selection mode"
```