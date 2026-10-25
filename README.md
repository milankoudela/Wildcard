# Private Discord bot

A private Node.js bot for one Discord server. It greets new members, provides
an administrator-managed campaign onboarding panel and private application
tickets, and includes a sample `/ping` command.

## Requirements

- Node.js 20 or newer
- A Discord application and bot created in the
  [Discord Developer Portal](https://discord.com/developers/applications)

## Setup

1. In the Developer Portal, create an application and add a bot.
2. Copy the bot token, application ID, and the target server's ID.
3. Copy `.env.example` to `.env` and fill in:
   - `DISCORD_TOKEN`: the bot token
   - `CLIENT_ID`: the application ID
   - `GUILD_ID`: the target server ID
4. In the Developer Portal, open **Bot → Privileged Gateway Intents** and enable
   **Server Members Intent**. The bot uses this to detect new members.
5. Invite the bot to the target server using the OAuth2 URL generator with the
   `bot` and `applications.commands` scopes. The bot needs permission to view
   channels, send messages, manage channels, and manage roles. Its highest role
   must be above access role `1563677636654407841` so it can assign that role
   after onboarding.
6. Install dependencies and register the slash command:

   ```sh
   npm install
   npm run deploy-commands
   ```

7. Start the bot:

   ```sh
   npm start
   ```

After starting the bot, an administrator can run `/onboarding` to post the
campaign panel in channel `1563620042841661644`. Users click **Start onboarding**
and submit their full name, email, and country. The bot creates one private
ticket per user at a time under category `1563686662402220043`, posts the
welcome and application details, and assigns access role
`1563677636654407841`. Administrators can run `/close-ticket` inside a ticket
to archive it; the ticket owner retains read access but can no longer send
messages. An archived ticket does not prevent that user from opening a new one.

The submitted full name is shown in the ticket greeting. The bot also saves
each user's full name and email in `data/creator-info.json`; administrators can
look them up privately with `/creatorinfo user:@username`. This file contains
personal data in plain text, is stored on the machine running the bot, and is
excluded from Git. Back it up securely if you need to preserve creator records
when moving or restoring the bot.

If the server has a custom emoji named `wildcard`, it is used in the embed
titles. Otherwise the titles display the literal `:wildcard:` placeholder.

When someone joins the configured server, the bot posts a welcome message in
channel `1563620140749430894` and directs them to onboarding. The bot checks
that it can access the configured server at startup and ignores slash commands
invoked in any other server. Keep `.env` private; never share or commit the bot
token.

## Adding a command

Add a command object to `src/commands.js` with `data` (a
`SlashCommandBuilder`) and an async `execute(interaction)` function. Run
`npm run deploy-commands` again after changing command definitions.
