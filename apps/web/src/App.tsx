import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "./routes/HomePage";

// The editor (Konva + GSAP later) is the heavy part of the bundle — code-split
// it so the landing page loads lean and tests never pull the canvas stack.
const EditorPage = lazy(() =>
  import("./routes/EditorPage").then((m) => ({ default: m.EditorPage })),
);

/**
 * App routes (plan §3): landing, the editor, and — later — the public viewer
 * `/p/:slug` (Phase 3.6 / 4.6). Unknown paths fall back to the landing page.
 */
export function App() {
  return (
    <BrowserRouter>
      <Suspense
        fallback={<div className="p-8 text-neutral-400">Loading editor…</div>}
      >
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/plan/:id/edit" element={<EditorPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
