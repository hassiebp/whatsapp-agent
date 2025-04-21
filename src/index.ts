import express from "express";
import { pinoHttp } from "pino-http";
import { processMessage } from "./services/message-processor.js";
import config from "./config/index.js";
import logger from "./services/logger.js";

const PORT = config.port;
const app = express();

const httpLogger = pinoHttp({
  logger,
  customProps: () => {
    return {
      service: "whatsapp-agent",
    };
  },
  autoLogging: {
    ignore: (req) => req.url === "/health",
  },
});

app.use(httpLogger);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/webhook/whatsapp", async (req, res) => {
  try {
    logger.info("Received webhook from Twilio");
    const result = await processMessage(req.body);

    if (!result.success) {
      logger.warn(result.error, "Message processing failed");
    } else {
      logger.info("Message processed successfully");
    }
  } catch (error) {
    logger.error(error, "Unhandled message processing error");
  } finally {
    res.status(200).send();
  }
});

app.listen(PORT, () => {
  logger.info({ port: PORT, environment: config.nodeEnv }, "✅ Server started");
});
