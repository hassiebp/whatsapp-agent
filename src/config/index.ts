import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string(),
  OPENAI_API_KEY: z.string(),
  TWILIO_ACCOUNT_SID: z.string(),
  TWILIO_AUTH_TOKEN: z.string(),
  TWILIO_PHONE_NUMBER: z.string(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_HOST: z.string().default('https://cloud.langfuse.com'),
});

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV === 'development',
  isTest: process.env.NODE_ENV === 'test',
  database: {
    url: process.env.DATABASE_URL as string,
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY as string,
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID as string,
    authToken: process.env.TWILIO_AUTH_TOKEN as string,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER as string,
  },
  langfuse: {
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    host: process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com',
  },
};

// Validate the environment variables or throw an error
try {
  envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('❌ Invalid environment variables:', JSON.stringify(error.format(), null, 2));
    process.exit(1);
  }
}

export default config;