**WhatsApp LLM Agent MVP – Technical Specification (Concise)**

**1. Overview**

This specification outlines a Minimum Viable Product (MVP) for a WhatsApp-based AI agent. Users interact one-on-one with an official WhatsApp Business number, sending text, images, or voice messages. The agent, powered by a multimodal LLM (e.g., GPT-4), provides intelligent responses. Key features include multimodal input handling, conversation context management (reset via "clear" command), and content safety filtering. The focus is on a functional proof-of-concept with a maintainable architecture using Node.js (TypeScript), Prisma, Supabase (Postgres/Storage), Google Cloud Run, Twilio WhatsApp API, and Langfuse for observability. The target is a small initial user base.

**2. Key Features**

- **Multimodal Input:** Accepts text, voice notes (transcribed), and images (analyzed).
- **LLM-Powered Responses:** Generates contextual answers, summaries (for long/monologue voice notes), or image descriptions.
- **Conversation Context:** Maintains chat history for follow-up questions within a session.
- **Context Reset:** User command "clear" (case-insensitive) resets the conversation history.
- **Content Safety:** Filters and refuses disallowed content (hate speech, explicit content, etc.) based on moderation checks.
- **One-on-One Interaction:** Designed exclusively for private chats, no group support.
- **User-Initiated:** Agent only responds to incoming user messages, adhering to WhatsApp policies.

**3. Technical Architecture**

- **Core Components:**

  - **Twilio WhatsApp API:** Gateway for incoming/outgoing messages via webhooks and API calls.
  - **Node.js Backend (Cloud Run):** TypeScript application handling webhooks, processing logic, calling external APIs, and managing persistence. Deployed on scalable Cloud Run.
  - **OpenAI API:** Provides LLM (GPT-4 for chat/vision) and Whisper (for audio transcription).
  - **Supabase Postgres:** Database managed via Prisma ORM for storing user and message data.
  - **Supabase Storage (Optional):** For temporary storage of media files (images, audio) if needed for analysis or debugging.
  - **Langfuse:** Integrated for LLM call tracing, debugging, and potentially prompt management.

- **Asynchronous Processing Flow:**
  1.  **Webhook Received:** Twilio POSTs to the Node.js backend endpoint on Cloud Run.
  2.  **Immediate Acknowledgement:** The Node.js server _immediately_ responds with `200 OK` to Twilio to prevent timeouts (Twilio expects a response within ~15 seconds).
  3.  **Background Processing:** The server continues processing the message asynchronously _after_ sending the 200 OK. This involves:
      - Parsing the message, identifying the user.
      - Downloading/processing media (if any) via Whisper or image analysis.
      - Performing content moderation checks.
      - Retrieving conversation history from Postgres.
      - Constructing the prompt and calling the OpenAI LLM API.
      - Checking for cancellation (if user sent a newer message).
      - Sending the final response back to the user via the Twilio API.
  4.  **State Management:** All state (conversation history) is persisted in the database, allowing stateless Cloud Run instances to handle requests.

**4. Data Model (Supabase Postgres via Prisma)**

- **`User` Table:**
  - `id` (PK), `phone` (string, unique), `isBanned` (boolean, default false), `createdAt`.
- **`Message` Table:**
  - `id` (PK), `userId` (FK to User), `role` (enum: 'user', 'assistant', 'system'), `type` (enum: 'text', 'image', 'audio', 'command'), `content` (text: original text, transcript, or description), `mediaUrl` (string, nullable: link to stored media), `mediaHash` (string, nullable: hash of media content for detecting duplicates), `createdAt` (timestamp), `moderationFlagged` (boolean, nullable), `moderationReason` (string, nullable).
- **Context Management:** Conversation history is retrieved by querying the `Message` table for a specific `userId`, ordered by `createdAt`, stopping at the most recent `Message` where `type` = 'command' and `content` = 'clear'.

**5. Message Processing Logic**

1.  **Intake & Classification:** Receive webhook, validate, send immediate 200 OK. Identify user, classify message type (text, image, audio). Check for "clear" command; if found, handle reset, confirm to user, and stop.
2.  **Media Handling:**
    - **Voice:** Download audio, transcribe using OpenAI Whisper. Store transcript in `Message.content`. Compute `mediaHash`. _No specific "forwarded" detection heuristic._ System prompt will guide LLM on how to handle transcripts (summarize if long/monologue-like, otherwise treat as query).
    - **Image:** Download image. Prepare for analysis (e.g., get public URL for GPT-4 Vision or generate description/OCR text as fallback). Store representation in `Message.content`.
3.  **Moderation:** Check `Message.content` (text, transcript, caption/OCR) using OpenAI Moderation API. If flagged, send refusal message, potentially ban user, log, and stop.
4.  **Context Retrieval:** Fetch relevant `Message` history for the user since the last "clear" command from Postgres.
5.  **Prompt Construction:** Assemble messages array: system prompt (defining role, rules, summarization logic for voice, safety guidelines), conversation history, and current user message. Use Langfuse for prompt template management if configured.
6.  **LLM Interaction:**
    - Log prompt input via Langfuse trace.
    - Call OpenAI ChatCompletion API (e.g., GPT-4) with the messages array (and image data if applicable).
    - Receive response. Log output/usage via Langfuse.
    - Perform safety check on LLM response (via Moderation API).
7.  **Response Handling & Dispatch:**
    - **Staleness Check:** Before sending, query DB to check if a newer message has arrived from the same user since the current one was received. If yes, discard this response (to avoid out-of-order replies).
    - If response is valid and not stale, send it to the user via Twilio API.
    - Save the assistant's response message to the database.

**6. Key Business Logic**

- **Voice Note Handling:** All voice notes are transcribed. The system prompt instructs the LLM to provide a concise summary if the transcript appears to be long-form content/monologue, otherwise answer it as a direct user query.
- **Content Moderation:** Strictly enforce rules against disallowed content on both user inputs and agent outputs. Refuse harmful requests and potentially ban repeat offenders.
- **"Clear" Command:** Acts as a hard delimiter for conversation context. Acknowledged to the user.
- **Concurrency & Cancellation:** Handle rapid messages from the same user by cancelling processing for earlier messages and responding only to the latest. Use a database check before sending the response to ensure it's not stale.

**7. Development & Observability**

- **Local Testing:** Use Twilio Sandbox and `ngrok` for end-to-end testing on localhost. Simulate webhooks with `curl` or Postman.
- **Langfuse:** Essential for tracing LLM calls, viewing prompts/responses, debugging context issues, and managing prompts.
- **Logging:** Utilize Cloud Run logging (Stackdriver) for application logs and error tracking. Consider Sentry for structured error reporting.
- **Deployment:** Containerize with Docker, deploy to Google Cloud Run. Manage secrets securely.
