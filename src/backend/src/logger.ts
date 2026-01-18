import fs from "fs";
import path from "path";
import pino from "pino";

const logsDir = path.join(process.cwd(), "logs");
fs.mkdirSync(logsDir, { recursive: true });

const errorFile = path.join(logsDir, "errors.log");

export const errorLogger = pino(
  {
    level: "error",
    base: undefined, // keep logs compact
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.destination({
    dest: errorFile,
    sync: false,
  })
);
