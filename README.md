# WhatsApp LLM Agent

A WhatsApp-based AI agent powered by a multimodal LLM. Users can interact one-on-one with the agent via an official WhatsApp Business number, sending text, images, or voice messages.

## Features

- **Multimodal Input**: Handles text, voice notes (transcribed), and images (analyzed)
- **LLM-Powered Responses**: Generates contextual answers, summaries, or image descriptions
- **Conversation Context**: Maintains chat history for natural conversation flow
- **Context Reset**: Use "clear" command to reset conversation history
- **Content Safety**: Filters disallowed content based on moderation checks
- **One-on-One Interaction**: Designed for private chats only

## Tech Stack

- **Backend**: Node.js with TypeScript
- **Database**: PostgreSQL via Prisma ORM
- **Storage**: Supabase Storage (optional)
- **API Integrations**: OpenAI, Twilio WhatsApp Business API
- **Observability**: Langfuse for LLM tracing and monitoring
- **Deployment**: Docker, Google Cloud Run

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm
- PostgreSQL database
- Twilio account with WhatsApp Business API access
- OpenAI API key
- Langfuse account (optional)

### Setup

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/whatsapp-agent.git
   cd whatsapp-agent
   ```

2. Install dependencies:
   ```
   pnpm install
   ```

3. Set up environment variables:
   ```
   cp .env.example .env
   ```
   Then edit the `.env` file with your credentials.

4. Set up the database:
   ```
   pnpm prisma migrate deploy
   ```

5. Start the development server:
   ```
   pnpm dev
   ```

### Local Testing

To test with Twilio webhooks locally:

1. Install ngrok: `npm install -g ngrok`
2. Start your local server: `pnpm dev`
3. Start ngrok: `ngrok http 3000`
4. Update your Twilio WhatsApp webhook URL to the ngrok URL + `/webhook/whatsapp`

## Deployment

This project is configured for deployment to Google Cloud Run:

1. Build the Docker image:
   ```
   docker build -t whatsapp-agent .
   ```

2. Deploy to Cloud Run:
   ```
   gcloud run deploy whatsapp-agent --image whatsapp-agent --platform managed
   ```

## License

[MIT](LICENSE)