import { Langfuse } from "langfuse";
import config from "../config/index.js";

export const langfuseClient = new Langfuse({ environment: config.nodeEnv });
