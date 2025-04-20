import express from "express";
import axios from "axios";
import { pinoHttp } from "pino-http";
import { processMessage } from "./services/message-processor.js";
import config from "./config/index.js";
import logger from "./services/logger.js";

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

app.get("/twilio-ping", async (_, res) => {
  const start = Date.now();
  try {
    await axios.get("https://api.twilio.com", {
      auth: {
        username: config.twilio.accountSid,
        password: config.twilio.authToken,
      },
    });
    res.send(`Twilio ping success in ${Date.now() - start}ms`);
  } catch (e: unknown) {
    res.send(`Twilio ping failed after ${Date.now() - start}ms: ${e}`);
  }
});

app.post("/webhook/whatsapp", async (req, res) => {
  // Important: Send immediate 200 OK response to Twilio
  // This prevents webhook timeouts as processing continues asynchronously
  res.status(200).send();

  logger.info("Received webhook from Twilio");

  try {
    processMessage(req.body)
      .then((result) => {
        if (!result.success) {
          logger.warn("Message processing completed with error:", result.error);
        } else {
          logger.info("Message processing completed successfully");
        }
      })
      .catch((error) => {
        logger.error("Unhandled error in message processing:", error);
      });
  } catch (error) {
    logger.error("Error starting message processing:", error);
  }
});

const PORT = config.port;

app.listen(PORT, () => {
  logger.info(`✅ Server running on port ${PORT}`);
  logger.info(`Environment: ${config.nodeEnv}`);
});
