import { Langfuse } from 'langfuse';
import config from '../config/index.js';

// Initialize Langfuse client if credentials are available
let langfuse: Langfuse | null = null;

if (config.langfuse.publicKey && config.langfuse.secretKey) {
  langfuse = new Langfuse({
    publicKey: config.langfuse.publicKey,
    secretKey: config.langfuse.secretKey,
    host: config.langfuse.host,
  });
  console.log('✅ Langfuse initialized');
} else {
  console.log('⚠️ Langfuse not initialized (missing credentials)');
}

/**
 * Creates a new trace in Langfuse for tracking LLM interactions
 * Returns null if Langfuse is not initialized
 */
export function createTrace(name: string, metadata?: Record<string, any>) {
  if (!langfuse) return null;
  
  return langfuse.trace({
    name,
    metadata,
    sessionId: metadata?.userId || undefined,
  });
}

/**
 * Logs a generation in Langfuse
 */
export function logGeneration(
  traceName: string, 
  generationName: string, 
  input: any, 
  output: any,
  metadata?: Record<string, any>
) {
  if (!langfuse) return null;
  
  const trace = langfuse.trace({ name: traceName });
  
  return trace.generation({
    name: generationName,
    input,
    output,
    metadata,
  });
}

/**
 * Logs an error in Langfuse
 */
export function logError(
  traceName: string,
  errorName: string,
  error: Error,
  metadata?: Record<string, any>
) {
  if (!langfuse) return null;
  
  const trace = langfuse.trace({ name: traceName });
  
  return trace.event({
    name: errorName,
    level: 'ERROR',
    input: error.message,
    output: error.stack,
    metadata,
  });
}