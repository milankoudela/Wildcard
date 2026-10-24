# Private Discord bot

A minimal Node.js bot intended for one Discord server. It uses guild-only slash
command registration and includes a sample `/ping` command.

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
4. Invite the bot to the target server using the OAuth2 URL generator with the
   `bot` and `applications.commands` scopes. The bot needs no privileged
   gateway intents for this starter.
5. Install dependencies and register the slash command:

   ```sh
   npm install
   npm run deploy-commands
   ```

6. Start the bot:

   ```sh
   npm start
   ```

The bot checks that it can access the configured server at startup and ignores
slash commands invoked in any other server. Keep `.env` private; never share or
commit the bot token.

## Adding a command

Add a command object to `src/commands.js` with `data` (a
`SlashCommandBuilder`) and an async `execute(interaction)` function. Run
`npm run deploy-commands` again after changing command definitions.
