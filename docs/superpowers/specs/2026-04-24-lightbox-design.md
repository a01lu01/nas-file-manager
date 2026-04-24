# Lightbox (Fullscreen Image Viewer) Design

## 1. Overview
Replace the existing right-drawer image preview with a dedicated, full-screen, immersive Lightbox component. The design focuses on high performance, touch compatibility, and a distraction-free viewing experience.

## 2. Visual Design & Layout
- **Container**: A fixed `z-50` overlay covering the entire viewport with a solid dark background (e.g., `bg-black/95` or pure black) for maximum contrast.
- **Image Display**: 
  - Centered horizontally and vertically.
  - Sized using `object-contain` to ensure the entire image fits within the screen without cropping.
- **Controls**:
  - **Top Bar**: A minimalist top bar (or just floating icons) containing:
    - Left: Current index / Total count (e.g., `15 / 120`) in a subtle, semi-transparent pill.
    - Right: A prominent `Close` (X) button.
  - **Navigation Arrows**: Left and Right arrows vertically centered on the edges of the screen (visible primarily on desktop/mouse environments, hidden or subtle on touch).

## 3. Interaction & Input

### Desktop (Mouse & Keyboard)
- **Keyboard**:
  - `Escape`: Close the lightbox.
  - `ArrowLeft` / `ArrowRight`: Navigate to previous/next image.
- **Mouse**:
  - Clicking the left/right arrow overlays navigates.
  - Clicking outside the image (on the black background) closes the lightbox.

### Mobile (Touch)
- **Swipe to Navigate**: 
  - Using basic `touchstart` and `touchend` event listeners.
  - If the horizontal swipe distance (delta X) exceeds a threshold (e.g., 50px) and is greater than the vertical distance, it triggers a navigation to the previous or next image.
  - No complex 1:1 drag-to-pan animations (user explicitly requested a simple trigger to avoid bugs).

## 4. Architecture & State Management

### Current State vs. New State
Currently, `Browser.tsx` uses:
```typescript
const [previewFile, setPreviewFile] = useState<{ item: FileItem; url: string; type: "image" | "video" | "unknown" } | null>(null);
```
When `previewFile.type === 'image'`, we will render the new `Lightbox` component instead of opening the `Sidebar` drawer.

### Data Fetching
- **Current Image**: We will use the existing `getThumbUrl(file)` logic. Since the Rust backend now generates high-quality thumbnails/proxies rapidly, we can use the same endpoint. If the user wants full resolution later, we can add a `&full=true` query param, but for now, the proxy endpoint is sufficient and fast.
- **Image List Context**: 
  - The Lightbox needs to know the array of *all* images in the current directory to enable next/prev navigation.
  - We already have a helper `getImagesInCurrentDir()` in `Browser.tsx`. We can pass this array, or just pass the `currentIndex` and a callback to request the next file.

### Proposed Component Structure
```tsx
interface LightboxProps {
  currentImage: FileItem;
  allImages: FileItem[]; // Filtered list of only images in the current dir
  onClose: () => void;
  onNavigate: (newImage: FileItem) => void;
  getProxyUrl: (file: FileItem) => string; // Function to construct the img src
}
```

## 5. Ambiguity & Edge Cases
- **Loading States**: Since we rely on the backend proxy, the image might take a few milliseconds to load. We should display a subtle loading spinner (or keep the previous image visible) until the new image's `onLoad` event fires, preventing a harsh black flash.
- **Zoom/Pan**: Excluded from this initial design iteration to maintain simplicity, as requested. We will rely on the browser/OS native pinch-to-zoom if applicable, or strictly `object-contain` for viewing.