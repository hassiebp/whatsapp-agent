import { pino } from "pino";
import config from "../config/index.js";

const transport = pino.transport({
  target: "pino-pretty",
  options: {
    colorize: true,
    translateTime: "SYS:standard",
    ignore: "pid,hostname",
  },
});

const logger = pino(
  {
    level: config.isDevelopment ? "debug" : "info",
    base: undefined,
  },
  config.isDevelopment ? transport : undefined,
);

export default logger;
