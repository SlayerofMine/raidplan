import pino from "pino";

/**
 * The application logger (plan §5.4). JSON to stdout, which journald captures
 * under the systemd unit — no file handling, no rotation to own.
 *
 * Silent under `test` so the suite's own request traffic doesn't spew logs, and
 * `LOG_LEVEL`-tunable in production without a code change.
 */
export const logger = pino({
  level:
    process.env.NODE_ENV === "test"
      ? "silent"
      : (process.env.LOG_LEVEL ?? "info"),
});
