import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "./routes/HomePage";

// The editor (Konva + GSAP later) is the heavy part of the bundle — code-split
// it so the landing page loads lean and tests never pull the canvas stack.
const EditorPage = lazy(() =>
  import("./routes/EditorPage").then((m) => ({ default: m.EditorPage })),
);
const ViewerPage = lazy(() =>
  import("./routes/ViewerPage").then((m) => ({ default: m.ViewerPage })),
);

/**
 * App routes (plan §3): landing, the editor, and the public viewer `/p/:slug`
 * (served from the local plan until Phase 4.6 adds sharing). Unknown paths fall
 * back to the landing page.
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
          {/*
            The viewer lives at /view/:slug, not /p/:slug: `/p/*` is the public
            *share link*, served by the API so Discord's crawler gets real Open
            Graph meta (it doesn't run JS, so the SPA shell would unfurl as
            nothing). Caddy proxies /p/* to the API in production; that page
            then hands humans on to this route.
          */}
          <Route path="/view/:slug" element={<ViewerPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
