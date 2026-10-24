import { SlashCommandBuilder } from "discord.js";

export const pingCommand = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check whether the bot is online."),
  async execute(interaction) {
    await interaction.reply("Pong!");
  },
};

export const commands = [pingCommand];
