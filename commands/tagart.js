// commands/tagart.js — "Tag art": right-click a post in the art channel →
// Apps → Tag art, to say who is in its images, which adventure it is from,
// or that it is not art at all (art.js).

const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Tag art')
    .setType(ApplicationCommandType.Message),
  execute: interaction => require('../art').handleTagArt(interaction)
};
