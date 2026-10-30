# Private Discord bot

A private Node.js bot for one Discord server. It opens a private onboarding
ticket for every new member, collects their application inside it, posts the
campaign briefs there with reaction roles, and includes a sample `/ping`
command.

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
   **Server Members Intent**. The bot uses this to detect members joining and
   leaving.
5. Invite the bot to the target server using the OAuth2 URL generator with the
   `bot` and `applications.commands` scopes. The bot needs permission to view
   channels, read message history, add reactions, send messages, manage
   channels, and manage roles. Its highest role must be above access role
   `1563677636654407841`, every campaign role used by a brief, and any role
   configured for reaction roles.
6. Install dependencies and register the slash commands:

   ```sh
   npm install
   npm run deploy-commands
   ```

7. Start the bot:

   ```sh
   npm start
   ```

Server-specific channel and role IDs live in `src/config.js`.

## Onboarding

When someone joins the configured server, the bot creates their private ticket
under category `1563686662402220043` and pings them in it. The ticket shows the
campaign overview and a **Start onboarding** button. Only the ticket owner can
use it: they submit their full name, email, and country, and the bot then

- posts the application in the ticket,
- saves the name and email for `/creatorinfo`,
- assigns access role `1563677636654407841`,
- posts a short next-steps message followed by the campaign briefs.

At the same time the bot posts a welcome message in channel
`1563620140749430894` linking the new member to their ticket. If the ticket
can't be created, the welcome message tags the staff role instead so someone
can open it with `/open-ticket`.

A ticket's channel topic records its owner and state
(`wildcard-onboarding-owner:<id>`, followed by `|pending` until the form is
submitted and `|archived` once closed). Don't edit ticket topics by hand.

- **Member leaves before submitting the form:** their ticket is deleted, so
  unused tickets don't fill the category (Discord allows 50 channels per
  category, archived tickets included).
- **Member leaves after onboarding and later rejoins:** their ticket is kept.
  When they come back, the bot links them to it and restores the access role and
  the campaign roles they had selected.
- **Members who joined while the bot was offline:** an administrator can run
  `/open-ticket user:@username`. Old onboarding panels still posted in
  `1563620042841661644` also keep working: their button now opens the user's
  ticket.

Administrators can run `/close-ticket` inside a ticket to archive it; the ticket
owner keeps read access but can no longer send messages or react, and brief
reactions in archived tickets no longer change roles. An archived ticket does
not prevent that user from getting a new one.

## Campaign briefs

Briefs are managed by administrators with `/briefs`:

- `/briefs add name link role [emoji]` adds a brief or updates the one with the
  same name. The emoji defaults to ✅; a custom emoji such as `<:name:id>` must
  belong to this server.
- `/briefs list` shows the configured briefs.
- `/briefs remove name` stops using a brief. Messages already posted stay in the
  tickets, but reacting to them no longer changes roles.
- `/briefs post [campaign] [all-tickets]` posts briefs in the current ticket, or
  in every open ticket whose member has completed onboarding. Briefs already in
  a ticket aren't posted twice; their text is refreshed if the brief changed.
  Use this after adding a brief, and once after upgrading so members who
  onboarded before the change get their briefs.

Each brief is its own message in the ticket with the brief link and the bot's
reaction. When the ticket owner adds that reaction they get the campaign role;
removing it removes the role. Reactions from anyone else are ignored. Briefs are
saved in `data/briefs.json`.

## Creator information

The submitted full name is shown in the ticket. The bot also saves each user's
full name and email in `data/creator-info.json`; administrators can look them up
privately with `/creatorinfo user:@username`. This file contains personal data
in plain text, is stored on the machine running the bot, and is excluded from
Git. Back it up securely if you need to preserve creator records when moving or
restoring the bot.

## Reaction roles

Administrators can configure a reaction role on any other message with
`/reaction-role`, providing the message ID, role ID, and a Unicode emoji or
custom emoji such as `<:name:id>`. The bot searches accessible text channels in
the configured server, adds the reaction to the message, assigns the role when a
member reacts, and removes the role if they remove the reaction. Rules are saved
in `data/reaction-roles.json`.

The `data/` folder is excluded from Git; keep it with the bot when moving or
restoring it.

If the server has a custom emoji named `wildcard`, it is used in the embed
titles. Otherwise the titles display the literal `:wildcard:` placeholder.

The bot checks that it can access the configured server at startup and ignores
interactions from any other server. Keep `.env` private; never share or commit
the bot token.

## Adding a command

Add a command object to `src/commands.js` with `data` (a
`SlashCommandBuilder`) and an async `execute(interaction)` function. Run
`npm run deploy-commands` again after changing command definitions.
