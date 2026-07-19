import { useCallback, useEffect, useRef, useState } from "react";
import type { Stage } from "konva/lib/Stage";
import { useToast } from "../ui/toastContext";
import {
  browserRecorderDeps,
  canRecordWebm,
  recordingFileName,
  startStageRecording,
  type RecordingHandle,
} from "./webmExport";

/**
 * React glue for {@link startStageRecording}: owns the in-progress handle and
 * the button's state, and reports the outcome through the toast system. The
 * recording itself is plain DOM work — see `webmExport.ts`, where it's testable.
 */
export interface StageRecorder {
  isRecording: boolean;
  /** False when the browser can't record WebM; the button is disabled then. */
  supported: boolean;
  /** Returns whether recording actually began, so the caller can sequence playback. */
  start: () => boolean;
  stop: () => void;
}

export function useStageRecorder(
  stageRef: { current: Stage | null },
  title: string,
): StageRecorder {
  const [isRecording, setIsRecording] = useState(false);
  const handle = useRef<RecordingHandle | null>(null);
  const { toast } = useToast();
  // Checked once: it can't change for the life of the page.
  const [supported] = useState(canRecordWebm);

  const stop = useCallback(() => {
    handle.current?.stop();
    handle.current = null;
    setIsRecording(false);
  }, []);

  const start = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || handle.current) return false;

    const started = startStageRecording({
      stage,
      filename: recordingFileName(title),
      deps: browserRecorderDeps(),
      onSaved: (filename) => toast(`Saved ${filename}`, "success"),
      onError: (message) => toast(message, "error"),
    });
    if (!started) return false;

    handle.current = started;
    setIsRecording(true);
    return true;
  }, [stageRef, title, toast]);

  // A recording must never outlive the page that owns it.
  useEffect(() => () => handle.current?.stop(), []);

  return { isRecording, supported, start, stop };
}
