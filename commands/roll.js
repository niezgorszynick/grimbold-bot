const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const rollTracker = require('../rollTracker');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Rzuć kością d100 (raz w tygodniu)!'),

  async execute(interaction) {
    // 1. Dajemy znać Discordowi, że przetwarzamy polecenie (eliminuje błąd timeoutu)
    await interaction.deferReply();

    try {
      const userId = interaction.user.id;

      // 2. Sprawdzenie w SQLite czy użytkownik już rzucał
      const check = rollTracker.canUserRoll(userId);

      if (!check.allowed) {
        return interaction.editReply({
          content: `⚠️ Już wykonałeś rzut w tym tygodniu! Twój wynik to: **${check.previousRoll}**. Kolejny rzut od poniedziałku.`
        });
      }

      // 3. Losowanie wartości d100 (od 1 do 100)
      const rollValue = Math.floor(Math.random() * 100) + 1;

      // 4. Zapis do bazy danych SQLite
      rollTracker.recordRoll(userId, rollValue);

      // 5. Zbudowanie i odesłanie odpowiedzi
      const embed = new EmbedBuilder()
        .setColor(0x00AE86)
        .setTitle('🎲 Wynik rzutu d100')
        .setDescription(`Wyrzuciłeś: **${rollValue}**!`)
        .setFooter({ text: `Tydzień: ${check.week}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Błąd podczas wykonywania /roll:', error);
      await interaction.editReply({
        content: 'Wystąpił błąd podczas rejestrowania rzutu. Spróbuj ponownie później.'
      });
    }
  },
};