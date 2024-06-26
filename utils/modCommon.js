// @ts-check
const { ButtonStyle } = require("discord.js"),
  Discord = require('discord.js'),
  u = require("../utils/utils"),
  config = require('../config/config.json'),
  { ActionRowBuilder, ButtonBuilder } = require("discord.js"),
  Augur = require('augurbot-ts');

/** @type {Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>[]} */
const modActions = [
  // @ts-ignore
  new ActionRowBuilder().setComponents([
    new ButtonBuilder().setCustomId("modCardClear").setEmoji("✅").setLabel("Clear").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("modCardVerbal").setEmoji("🗣").setLabel("Talk it out").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("modCardMinor").setEmoji("⚠").setLabel("Minor").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("modCardMajor").setEmoji("⛔").setLabel("Major").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("modCardMute").setEmoji("🔇").setLabel("Mute").setStyle(ButtonStyle.Danger)
  ]),
  // @ts-ignore
  new ActionRowBuilder().setComponents([
    new ButtonBuilder().setCustomId("modCardInfo").setEmoji("👤").setLabel("User Info").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("modCardLink").setEmoji("🔗").setLabel("Link to Discuss").setStyle(ButtonStyle.Secondary)
  ])
];
/** @param {Discord.GuildMember|Discord.User} person */
const userBackup = (person) => `${person} (${u.escapeText(person.displayName)})`;

/** @type {Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>} */
const retract = new ActionRowBuilder();
retract.setComponents([
  new ButtonBuilder().setCustomId("modCardRetract").setEmoji("⏪").setLabel("Retract").setStyle(ButtonStyle.Danger)
]);

const messageFromMods = "## 🚨 Message from the LDSG Mods:\n";
const code = "[Code of Conduct](<http://ldsgamers.com/code-of-conduct>) (<http://ldsgamers.com/code-of-conduct>)";

/**
  * Give the mods a heads up that someone isn't getting their DMs.
  * @param {Discord.GuildMember} member The guild member that's blocked.
  */
function blocked(member) {
  return member.client.getTextChannel(u.sf.channels.modlogs)?.send({ embeds: [
    u.embed({
      author: member,
      color: 0x00ffff,
      title: `${member.displayName} has me blocked. *sadface*`
    })
  ] });
}

/**
 * See if a user is manageable by a mod
 * @param {Discord.GuildMember} mod
 * @param {Discord.GuildMember} target
 */
function compareRoles(mod, target) {
  const modHigh = mod.roles.cache.filter(r => r.id != u.sf.roles.live)
    .sort((a, b) => b.comparePositionTo(a)).first();
  const targetHigh = target.roles.cache.filter(r => r.id != u.sf.roles.live)
    .sort((a, b) => b.comparePositionTo(a)).first();
  if (!modHigh || !targetHigh) return false;
  return (modHigh.comparePositionTo(targetHigh) > 0);
}

/** Generate a random name */
function nameGen() {
  const { names, colors, adjectives } = require("../data/nameParts.json");
  let result = u.rand(adjectives) + " " + u.rand(colors) + " " + u.rand(names);
  while (result.length > 32) { result = u.rand(adjectives) + " " + u.rand(colors) + " " + u.rand(names); }
  return result;
}

const modCommon = {
  blocked,
  compareRoles,
  nameGen,
  modActions,
  revert: retract,
  /**
   * BAN HAMMER!!!
   * @param {Augur.GuildInteraction<"CommandSlash"|"SelectMenuString">} interaction
   * @param {Discord.GuildMember} target
   * @param {string} reason
   * @param {number} days
   */
  ban: async function(interaction, target, reason, days = 1) {
    let success = false;
    try {
      if (!compareRoles(interaction.member, target)) return `You have insufficient permissions to ban ${target}!`;
      else if (!target.bannable) return `I have insufficient permissions to ban ${target}!`;

      const confirm = await u.confirmInteraction(interaction, `Ban ${target} for:\n${reason}?`, `Confirm Ban on ${u.escapeText(target.displayName)}`);
      if (!confirm) {
        return {
          embeds: [u.embed({ author: interaction.member }).setColor(0x0000ff).setDescription(`Ban ${confirm === false ? "cancelled" : "timed out"}`)],
          components: []
        };
      } else if (confirm) {

        // The actual ban part
        const targetRoles = target.roles.cache.clone();
        await target.send({ content: messageFromMods, embeds: [ u.embed()
          .setTitle("User Ban")
          .setDescription(`You have been banned in ${interaction.guild.name} for:\n${reason}`)
        ] }).catch(() => blocked(target));
        await target.ban({ deleteMessageSeconds: days * 24 * 60 * 60, reason });
        success = true;
        // Save infraction
        u.db.infraction.save({
          discordId: target.id,
          description: `[User Ban]: ${reason}`,
          value: 30,
          mod: interaction.member.id
        });

        // Save roles
        targetRoles.delete(u.sf.roles.trusted);
        u.db.user.updateRoles(target, targetRoles.map(r => r.id));

        // Log it
        interaction.client.getTextChannel(u.sf.channels.modlogs)?.send({ embeds: [
          u.embed({ author: target })
            .setTitle("User Ban")
            .setDescription(`**${interaction.member}** banned **${userBackup(target)}** for:\n${reason}`)
            .setFooter({ text: `Deleted ${days} day(s) of messages` })
            .setColor(0x0000ff)
        ] });
        // Return results
        return {
          embeds: [
            u.embed({ author: target })
              .setColor(0x00ff00)
              .setDescription(`${target.toString()} banned for:\n${reason}`)
          ],
          components: []
        };
      }
      return "...Nothing happened.";
    } catch (error) {
      await u.errorHandler(error, interaction);
      return "I ran into an error! " + (success ? `${target} was banned though.` : `${target} wasn't banned.`);
    }
  },

  /**
   * Generate and send a warning card in #mod-logs
   * @param {object} flagInfo
   * @param {Discord.Message} [flagInfo.msg] The message for the warning.
   * @param {Discord.GuildMember|Discord.User} flagInfo.member The member for the warning.
   * @param {String|String[]} [flagInfo.matches] If automatic, the reason for the flag.
   * @param {Boolean} [flagInfo.pingMods] Whether to ping the mods.
   * @param {String} [flagInfo.snitch] The user bringing up the message.
   * @param {String} flagInfo.flagReason The reason the user is bringing it up.
   * @param {String} [flagInfo.furtherInfo] Where required, further information.
   * @param {Discord.CommandInteraction|Discord.AnySelectMenuInteraction} [interaction] Optional interaction property to provide missing details
   */
  createFlag: async function(flagInfo, interaction) {
    let { matches } = flagInfo;
    const { msg, member, pingMods, snitch, flagReason, furtherInfo } = flagInfo;
    const client = msg?.client ?? member?.client;
    const isMember = member instanceof Discord.GuildMember;
    const bot = () => isMember ? member.user.bot : member.bot;

    if (msg && !msg.inGuild()) return null;

    const infractionSummary = await u.db.infraction.getSummary(member.id);
    const embed = u.embed({ color: 0xff0000, author: member });

    if (Array.isArray(matches)) matches = matches.join(", ");
    if (matches) embed.addFields({ name: "Matched", value: matches });
    if (msg) {
      embed.setTimestamp(msg.editedAt ?? msg.createdAt)
        .setDescription((msg.editedAt ? "[Edited]\n" : "") + msg.cleanContent || null)
        .addFields(
          { name: "Channel", value: msg.channel?.toString(), inline: true },
          { name: "Jump to Post", value: `[Original Message](${msg.url})`, inline: true },
          { name: "User", value: msg.webhookId ? userBackup(msg.author) ?? (await msg.fetchWebhook()).name : userBackup(msg.author) ?? "Unknown User" }
        );
      if (msg.channel.parentId == u.sf.channels.minecraftcategory && msg.webhookId) {
        msg.client.getTextChannel(u.sf.channels.minecraftmods)?.send({ embeds: [embed] });
      }
    } else if (interaction) {
      embed.setTimestamp(interaction.createdAt)
        .setDescription("User Reported!")
        .addFields(
          { name: "Channel", value: `<#${interaction.channelId}>`, inline: true }
        );
    }
    if (snitch) {
      embed.addFields(
        { name: "Flagged By", value: snitch, inline: true },
        { name: "Reason", value: flagReason, inline: true }
      );
      if (furtherInfo) embed.addFields({ name: "Further Information", value: furtherInfo, inline: true });
    } else if (flagReason) {
      embed.addFields({ name: "Reason", value: flagReason });
    }

    embed.addFields({ name: `Infraction Summary (${infractionSummary.time} Days)`, value: `Infractions: ${infractionSummary.count}\nPoints: ${infractionSummary.points}` });
    if (bot()) embed.setFooter({ text: "The user is a bot and the flag likely originated elsewhere. No action will be processed." });

    const content = [];
    if (pingMods) {
      if (msg) u.clean(msg, 0);
      const ldsg = client.guilds.cache.get(u.sf.ldsg);
      if (isMember ? !member.roles.cache.has(u.sf.roles.muted) : true) {
        content.push(ldsg?.roles.cache.get(u.sf.roles.mod)?.toString());
      }
      if (bot()) {
        content.push("The message has been deleted. The member was *not* muted, on account of being a bot.");
      } else {
        if (isMember && !member.roles?.cache.has(u.sf.roles.muted)) {
          await member.roles?.add(u.sf.roles.muted);
          if (member.voice?.channel) {
            member.voice?.disconnect("Auto-mute");
          }
          ldsg?.client.getTextChannel(u.sf.channels.muted)?.send({
            content: `${member}, you have been auto-muted in ${msg?.guild.name ?? "LDS Gamers"}. Please review our ${code}. A member of the mod team will be available to discuss more details.`,
            allowedMentions: { users: [member.id] }
          });
        }
        content.push("The mute role has been applied and message deleted.");
      }
    }

    const card = await client.getTextChannel(u.sf.channels.modlogs)?.send({
      content: content.join('\n'),
      embeds: [embed],

      components: ((bot() || !msg) ? undefined : modActions),
      allowedMentions: { roles: [u.sf.roles.mod] }
    });

    if (!card) throw new Error("Card creation failed!");

    if (!bot() && msg) {
      const infraction = {
        discordId: member.id,
        channel: msg.channel.id,
        message: msg.id,
        flag: card.id,
        description: msg.cleanContent,
        mod: client.user.id,
        value: 0
      };
      await u.db.infraction.save(infraction);
    }
    return card;
  },

  /**
   * Get a summary embed
   * @param {Discord.GuildMember|Discord.User} member
   * @param {number} [time]
   * @param {Discord.Guild} [guild]
   */
  getSummaryEmbed: async function(member, time, guild) {
    const isMember = member instanceof Discord.GuildMember;
    const data = await u.db.infraction.getSummary(member.id, time);
    const response = [`**${member}** has had **${data.count}** infraction(s) in the last **${data.time}** day(s), totaling **${data.points}** points.`];
    if ((data.count > 0) && (data.detail.length > 0)) {
      data.detail = data.detail.reverse(); // Newest to oldest is what we want
      for (const record of data.detail) {
        const g = isMember ? member.guild : guild;
        const mod = g?.members.cache.get(record.mod);
        const handler = g?.members.cache.get(record.handler ?? "");
        const pointsPart = record.value === 0 && (mod?.id != member.client.user.id) ? "Note" : `${record.value} pts`;
        response.push(`\`${record.timestamp.toLocaleDateString()}\` (${pointsPart}, Mod: ${mod || `Unknown Mod (<@${record.mod }>)`}${handler ? `, Handler: ${handler}` : ""}): ${record.description}`);
      }
    }

    let text = response.join("\n");
    text = text.length > 4090 ? text.substring(0, 4086) + "..." : text;

    const userDoc = await u.db.user.fetchUser(member.id);
    let roleString = isMember ? member.roles.cache.sort((a, b) => b.comparePositionTo(a)).map(role => role.name).join(", ") : "[Unknown]";
    if (roleString.length > 1024) roleString = roleString.slice(0, 1020) + "...";

    return u.embed({ author: member })
      .setTitle("Infraction Summary")
      .setDescription(text)
      .setColor(0x00ff00)
      .addFields(
        { name: "ID", value: member.id, inline: true },
        { name: "Activity", value: `Active Minutes: ${userDoc?.posts ?? "Unknown"}`, inline: true },
        { name: "Roles", value: roleString },
        { name: "Joined", value: isMember ? member.joinedAt ? u.time(member.joinedAt, 'R') : "unknown" : "unknown", inline: true },
        { name: "Account Created", value: u.time((isMember ? member.user : member).createdAt, 'R'), inline: true }
      );
  },

  /**
   * They get the boot
   * @param {Augur.GuildInteraction<"CommandSlash"|"SelectMenuString">} interaction
   * @param {Discord.GuildMember} target
   * @param {string} reason
   */
  kick: async function(interaction, target, reason) {
    let success = false;
    try {
      if (!compareRoles(interaction.member, target)) return `You have insufficient permissions to kick ${target}!`;
      else if (!target.kickable) return `I have insufficient permissions to kick ${target}!`;

      const confirm = await u.confirmInteraction(interaction, `Kick ${target} for:\n${reason}?`, `Confirm Kick on ${u.escapeText(target.displayName)}`);

      if (!confirm) {
        return {
          embeds: [u.embed({ author: target }).setColor(0x0000ff).setDescription(`Kick ${confirm === false ? "cancelled" : "timed out"}`)],
          components: []
        };
      } else if (confirm) {
        // The actual kick part
        const targetRoles = target.roles.cache.clone();
        await target.send({ content: messageFromMods, embeds: [
          u.embed()
          .setTitle("User Kick")
          .setDescription(`You have been kicked in ${interaction.guild.name} for:\n${reason}`)
        ] }).catch(() => blocked(target));
        await target.kick(reason);
        success = true;
        // Save infraction
        u.db.infraction.save({
          discordId: target.id,
          description: `[User Kick]: ${reason}`,
          value: 30,
          mod: interaction.member.id
        });

        // Save roles
        targetRoles.delete(u.sf.roles.trusted);
        u.db.user.updateRoles(target, targetRoles.map(r => r.id));

        // Log it
        interaction.client.getTextChannel(u.sf.channels.modlogs)?.send({ embeds: [
          u.embed({ author: target })
          .setTitle("User Kick")
          .setDescription(`**${interaction.member}** kicked **${userBackup(target)}** for:\n${reason}`)
          .setColor(0x0000ff)
        ] });
        return {
          embeds: [
            u.embed({ author: target })
            .setColor(0x00ff00)
            .setDescription(`${target.toString()} kicked for:\n${reason}`)
          ],
          components: []
        };
      }
      return "...Nothing happened";
    } catch (error) {
      await u.errorHandler(error, interaction);
      return `I ran into an error! ${target} ` + (success ? "*was* kicked though." : "wasn't kicked.");
    }
  },

  /**
   * Prevent someone from talking
   * @param {Augur.GuildInteraction<"CommandSlash"|"SelectMenuString">} interaction
   * @param {Discord.GuildMember} target
   * @param {string} [reason]
   */
  mute: async function(interaction, target, reason = "[No Reason]", apply = true) {
    const m = apply ? "mute" : "unmute";
    const M = apply ? "Mute" : "Unmute";
    let success = 0;
    try {
      if (!target.manageable) return `I have insufficient permissions to ${m} ${target}!`;

      // Don't mute if muted or vice versa
      if (target.roles.cache.has(u.sf.roles.muted) == apply) return `${target} is already ${m}d.`;

      // Impose Mute or Unmute
      if (apply) await target.roles.add(u.sf.roles.muted);
      else await target.roles.remove(u.sf.roles.muted);
      success = 1; // role changed

      // Disconnect from VC and mute (or unmute)
      if (apply && target.voice.channel) {
        await target.voice.disconnect(reason);
        await target.voice.setMute(true, reason);
      } else if (target.voice.channel) {
        await target.voice.setMute(false, reason);
      }
      success = 2; // vc status changed

      await interaction.client.getTextChannel(u.sf.channels.modlogs)?.send({ embeds: [
        u.embed({ author: target })
        .setTitle(`Member ${M}`)
        .setDescription(`**${interaction.member}** ${m}d **${userBackup(target)}** for:\n${reason}`)
        .setColor(apply ? 0x0000ff : 0x00ff00)
      ] });

      if (apply) {
        await interaction.client.getTextChannel(u.sf.channels.muted)?.send({ content:
          `${target}, you have been muted in ${interaction.guild.name}. `
        + `Please review our ${code}.\n`
        + 'A member of the mod team will be available to discuss more details.',
        allowedMentions: { parse: ["users"] } });
      }

      return `${M}d ${target}.`;
    } catch (error) {
      await u.errorHandler(error, interaction);
      return "I ran into an error! " + (
        success > 1 ? `${target} *was* ${m}d and they're ${apply ? "not able" : "able"} to speak in voice channels.`
          : success > 0 ? `They *were* ${m}d, but they may or may not be able to speak in voice channels.`
            : `They weren't ${m}d and may or may not be able to speak in voice channels.`
      );
    }
  },

  /**
   * Write down a note on a user
   * @param {Augur.GuildInteraction<"CommandSlash"|"Modal">} interaction
   * @param {Discord.GuildMember|Discord.User} target
   * @param {string} note
   */
  note: async function(interaction, target, note) {
    let success = false;
    try {
      await u.db.infraction.save({
        discordId: target.id,
        value: 0,
        description: note,
        mod: interaction.user.id
      });
      success = true;
      const summary = await u.db.infraction.getSummary(target.id);

      await interaction.client.getTextChannel(u.sf.channels.modlogs)?.send({ embeds: [
        u.embed({ author: target })
        .setColor("#0000FF")
        .setDescription(note)
        .addFields(
          { name: "Resolved", value: `${userBackup(interaction.member)} added a note.` },
          { name: `Infraction Summary (${summary.time} Days)`, value: `Infractions: ${summary.count}\nPoints: ${summary.points}` }
        )
        .setTimestamp()
      ] });

      return `Note added for user ${target.toString()}.`;
    } catch (error) {
      await u.errorHandler(error, interaction);
      return "I ran into an error! " + (success ? "I *was* able to save the note though." : "I wasn't able to save the note");
    }
  },

  /**
   * Send someone to Ghost's Office
   * @param {Augur.GuildInteraction<"CommandSlash">} interaction
   * @param {Discord.GuildMember} target
   * @param {string} reason
   */
  office: async function(interaction, target, reason, apply = true) {
    let success = false;
    try {
      const put = apply ? `put ${target} in` : `released ${target} from`;
      if (!target.manageable) return `I have insufficient permissions to ${put} the office!`;

      // don't do it if it wont do anything
      if (target.roles.cache.has(u.sf.roles.ducttape) == apply) return `${target} is ${apply ? "already" : "not"} in the office.`;

      // do it
      if (apply) await target.roles.add(u.sf.roles.ducttape);
      else await target.roles.remove(u.sf.roles.ducttape);
      success = true;

      // log it;
      await interaction.client.getTextChannel(u.sf.channels.modlogs)?.send({ embeds: [
        u.embed({ author: target })
          .setTitle(`Member ${apply ? "Sent to" : "Released from"} Office`)
          .setDescription(`**${interaction.member}** ${put} the office for:\n${reason}`)
          .setColor(0x0000ff)
      ] });

      if (apply) {
        await interaction.client.getTextChannel(u.sf.channels.office)?.send({ content:
          `${target}, you have been sent to the office in ${interaction.guild.name}.\n`
          + 'This allows you and the mods to have a private space to discuss issues or concerns.\n'
          + `Please review our ${code}.`
          + 'A member of the mod team will be available to discuss more details.',
        allowedMentions: { parse: ['users'] }
        });
      }

      return `${target} has been ${apply ? "sent to" : "released from"} the office!`;
    } catch (error) {
      await u.errorHandler(error, interaction);
      return "I ran into an error! " + (success ? "They *were* sent to the office though." : "They weren't sent to the office.");
    }
  },

  /**
   *
   * @param {Augur.GuildInteraction<"CommandSlash"|"Modal">} interaction
   * @param {Discord.GuildMember} target
   * @param {string} newNick
   */
  rename: async function(interaction, target, newNick, reset = false) {
    let success = false;
    try {
      const oldNick = target.displayName;
      if (!target.manageable) return `I have insufficient permissions to rename ${target}!`;

      await target.setNickname(reset ? null : newNick);
      success = true;

      const comment = `Set nickname to ${u.escapeText(reset ? "default" : newNick)} from ${u.escapeText(oldNick)}.`;

      if (!reset) {
        await target.send(
          messageFromMods + `We have found that your ${oldNick == target.user.displayName ? "username" : "server nickname"} is in violation of our ${code}.\n`
          + `We've taken the liberty of setting a new server nickname (**${newNick}**) for you. Please reach out if you have any questions.`
        ).catch(() => blocked(target));
        await u.db.infraction.save({
          discordId: target.id,
          value: 0,
          description: comment,
          message: interaction.id,
          channel: interaction.channel?.id,
          mod: interaction.member.id
        });
      }
      const summary = await u.db.infraction.getSummary(target.id);

      interaction.client.getTextChannel(u.sf.channels.modlogs)?.send({ embeds: [
        u.embed({ author: target })
        .setColor("#0000FF")
        .setDescription(comment)
        .addFields(
          { name: "Resolved", value: `${interaction.member} changed ${userBackup(target)}'s nickname from ${u.escapeText(oldNick)} to ${u.escapeText(reset ? "default" : newNick)}.` },
          { name: `Infraction Summary (${summary.time} Days) `, value: `Infractions: ${summary.count}\nPoints: ${summary.points}` }
        )
        .setTimestamp()
      ] });

      return `${target}'s nickname changed from ${u.escapeText(oldNick)} to ${u.escapeText(reset ? "default" : newNick)}.`;
    } catch (error) {
      await u.errorHandler(error, interaction);
      return "I ran into an error! " + (success ? "I *was* able to rename them though." : "I wasn't able to rename them.");
    }
  },

  /**
   * @param {string[]} searchContent
   * @param {Discord.Guild} guild
   * @param {Discord.Message<true>} message
   * @param {boolean} auto
   */
  spamCleanup: async function(searchContent, guild, message, auto = false) {
    const timeDiff = config.spamThreshold.cleanupLimit * (auto ? 1 : 2) * 1000;
    const contents = u.unique(searchContent);
    const promises = [];
    for (const [, channel] of guild.channels.cache) {
      const perms = channel.permissionsFor(message.client.user);
      if (!channel.isTextBased() || !perms?.has("ManageMessages") || !perms.has("ViewChannel") || !perms.has("Connect")) continue;
      const fetched = await channel.messages.fetch({ around: message.id, limit: 30 });
      const messages = fetched.filter(m =>
        m.createdTimestamp <= (timeDiff + message.createdTimestamp) &&
        m.createdTimestamp >= (message.createdTimestamp - timeDiff) &&
        m.author.id == message.author.id &&
        contents.includes(m.content.toLowerCase())
      );
      if (messages.size > 0) promises.push(channel.bulkDelete(messages, true));
    }
    if (promises.length > 0) {
      const resolved = await Promise.all(promises);
      const deleted = resolved.flatMap(a => a.size).reduce((p, c) => p + c, 0);
      const channels = u.unique(resolved.flatMap(a => a.map(b => b?.channel.toString())));
      return { deleted, channels };
    } else {
      return null;
    }
  },

  /**
   * Briefly prevent someone from talking
   * @param {Augur.GuildInteraction<"CommandSlash"|"SelectMenuString">} interaction
   * @param {Discord.GuildMember} target
   * @param {number} time Minutes, default is 10
   * @param {string} [reason]
   */
  timeout: async function(interaction, target, time = 10, reason) {
    const apply = time > 0;
    const t = apply ? "time out" : "release";
    const td = apply ? "timed out" : "released";
    const T = apply ? "Timed Out" : "Released from Time Out";
    let success = false;
    try {
      if (!target.manageable) return `I have insufficient permissions to ${t} ${target}!`;

      // Don't mute if muted or vice versa
      if (!apply && !target.communicationDisabledUntil) return `${target} is already ${td}.`;

      // Impose Timeout
      await target.timeout(time * 60 * 1000 || null, reason);
      success = true; // role changed

      await interaction.client.getTextChannel(u.sf.channels.modlogs)?.send({ embeds: [
        u.embed({ author: target })
        .setTitle(`User ${T}`)
        .setDescription(`**${interaction.member}** ${td} **${userBackup(target)}** ${apply ? `for ${time} minutes\n` : ""}\nReason:\n${reason ?? "[No Reason Provided]"}`)
        .setColor(apply ? 0x0000ff : 0x00ff00)
      ] });

      return `${target} has been ${td}${apply ? ` for ${time} minutes` : ""}.`;
    } catch (error) {
      await u.errorHandler(error, interaction);
      return "I ran into an error! " + (success ? `They *were* ${td} though.` : `I wasn't able to do the ${t}`);
    }
  },

  /**
   * Give someone the Trusted Role
   * @param {Augur.GuildInteraction<"CommandSlash"|"SelectMenuString">} interaction
   * @param {Discord.GuildMember} target
   */
  trust: async function(interaction, target, apply = true) {
    let success = false;
    try {
      if (target.roles.cache.has(u.sf.roles.trusted) == apply) return `${target} is ${apply ? "already trusted" : "not trusted yet"}!`;
      const embed = u.embed({ author: target });
      if (apply) {
        await target.roles.add(u.sf.roles.trusted);
        success = true;
        target.send(
          "## Congratulations!\n"
          + `You have been marked as "Trusted" in ${interaction.guild.name} . `
          + "This means you are now permitted to post images and links in chat. "
          + `Please remember to follow our ${code} when doing so.\n\n`
          + "If you'd like to join one of our in-server Houses, you can visit <http://3houses.live> to get started!"
        ).catch(() => blocked(target));
        embed.setTitle("User Given Trusted").setDescription(`${interaction.member} trusted ${userBackup(target)}).`);
      } else {
        await target.roles.remove([u.sf.roles.trusted, u.sf.roles.trustedplus]);
        success = true;
        target.send(messageFromMods + `You have been removed from "Trusted" in ${interaction.guild.name}.\n`
          + "This means you no longer have the ability to post images. "
          + `Please remember to follow our ${code} when posting images or links in the future.\n`
        ).catch(() => blocked(target));
        embed.setTitle("User Trust Removed").setDescription(`${interaction.member} untrusted ${userBackup(target)}.`);
      }
      await modCommon.watch(interaction, target, !apply);
      interaction.client.getTextChannel(u.sf.channels.modlogs)?.send({ embeds: [embed] });
      return `${target} has been ${apply ? "given" : "removed from"} the Trusted role!`;
    } catch (error) {
      await u.errorHandler(error, interaction);
      return `I ran into an error! ${target}` + (success ? ` *was*${apply ? "" : " removed from"} Trusted though.` : "'s Trusted status didn't change.");
    }
  },

  /**
   * Give someone the Trusted+ Role
   * @param {Augur.GuildInteraction<"CommandSlash"|"SelectMenuString">} interaction
   * @param {Discord.GuildMember} target
   */
  trustPlus: async function(interaction, target, apply = true) {
    let success = false;
    try {
      if (target.roles.cache.has(u.sf.roles.trustedplus) == apply) return `${target} ${apply ? "already has" : "doesn't have"} the Trusted+ role!`;
      if (apply && !target.roles.cache.has(u.sf.roles.trusted)) return `${target} needs the Trusted role before they can get the Trusted+ role!`;
      const embed = u.embed({ author: target });

      if (apply) {
        await target.roles.add(u.sf.roles.trustedplus);
        success = true;
        target.send(
          "## Congratulations!\n"
          + "You've been added to the Trusted+ list in LDSG, allowing you to stream to voice channels!\n\n"
          + `While streaming, please remember the Streaming Guidelines ( https://goo.gl/Pm3mwS ) and our ${code}.`
          + "Also, please be aware that LDSG may make changes to the Trusted+ list from time to time at its discretion."
        ).catch(() => blocked(target));
        embed.setTitle("User Given Trusted+").setDescription(`${interaction.member} gave ${userBackup(target)} the <@&${u.sf.roles.trustedplus}> role.`);
      } else {
        await target.roles.remove(u.sf.roles.trustedplus);
        success = true;
        target.send(messageFromMods +
          `You have been removed from "Trusted+" in ${interaction.guild.name}. `
          + "This means you no longer have the ability to stream video in the server. "
          + `Please remember to follow our ${code}.`
        ).catch(() => blocked(target));

        embed.setTitle("User Trusted+ Removed")
        .setDescription(`${interaction.member} removed the <@&${u.sf.roles.trustedplus}> role from ${userBackup(target)}.`);
      }
      interaction.client.getTextChannel(u.sf.channels.modlogs)?.send({ embeds: [embed] });
      return `${target} has been ${apply ? "added to" : "removed from"} the Trusted+ role!`;
    } catch (error) {
      await u.errorHandler(error, interaction);
      return `I ran into an error! ${target}` + (success ? ` *was*${apply ? "" : " removed from"} Trusted+ though.` : "'s Trusted+ status didn't change.");
    }
  },

  /**
   * Add or remove someone from the watch list
   * @param {Discord.Interaction<"cached">|Discord.Message} interaction
   * @param {Discord.GuildMember|string} target
   * @param {boolean} apply
   */
  watch: async function(interaction, target, apply = true) {
    let success = true;
    try {
      if (typeof target != 'string' && (target.user.bot)) return `${target} is a bot and shouldn't be watched.`;
      const id = typeof target == "string" ? target : target.id;
      const watchlist = await u.db.user.getUsers({ watching: true });
      if (apply && (watchlist.find(w => w.discordId == id) || modCommon.watchlist.has(id))) return `${target} was already on the watchlist!`;
      if (!apply && (!watchlist.find(w => w.discordId == id) && !modCommon.watchlist.has(id))) return `${target} wasn't on the watchlist. They might not have the trusted role.`;

      await u.db.user.updateWatch(id, apply);
      if (apply) modCommon.watchlist.add(id);
      else modCommon.watchlist.delete(id);
      success = true;

      if (typeof target != 'string') {
        const watchLog = interaction.client.getTextChannel(u.sf.channels.modWatchList);
        const notifDesc = [
          `**added** to the watchlist by ${interaction.member}.\nUse </mod watch:${u.sf.commands.slashMod}> to remove them.`,
          `**removed** from the watchlist by ${interaction.member}.\nUse </mod watch:${u.sf.commands.slashMod}> to re-add them.`
        ];
        const embed = u.embed({ author: target })
          .setTitle(apply ? "Watching User 👀" : "Un-Watching User 💤")
          .setColor(apply ? 0x00FF00 : 0xFF8800)
          .setDescription(`${userBackup(target)} has been ${notifDesc[apply ? 0 : 1]}`);
        watchLog?.send({ embeds: [embed] });
      }
      return `I'm${apply ? "" : " no longer"} watching ${target} ${apply ? "now :eyes:" : "anymore :zzz:"}.`;
    } catch (error) {
      await u.errorHandler(error, interaction);
      return "I ran into an error! " + (success ? `They *were* ${apply ? "put on" : "taken off"} the watchlist though.` : `They weren't ${apply ? "put on" : "taken off"} the watch list.`);
    }
  },

  /**
   * @param {Discord.Interaction<"cached">} interaction
   * @param {string} reason
   * @param {number} value
   * @param {Discord.GuildMember} target
   * @param {Discord.Message} [message]
  */
  warn: async function(interaction, reason, value, target, message) {
    let success = false;
    try {
      const embed = u.embed({ author: target })
        .setColor("#0000FF")
        .setDescription("Reason: " + reason)
        .addFields({ name: "Resolved", value: `${userBackup(interaction.member ?? interaction.user)} issued a ${value} point warning.` })
        .setTimestamp();
      if (message?.cleanContent) embed.addFields({ name: "Message Content", value: message.cleanContent });
      const flag = await interaction.client.getTextChannel(u.sf.channels.modlogs)?.send({ embeds: [embed] });

      await u.db.infraction.save({
        discordId: target.id,
        value: value,
        message: message?.id,
        channel: message?.channel.id,
        description: reason ?? "",
        flag: flag?.id ?? "unknown",
        mod: interaction.member.id,
        handler: interaction.member.id
      });
      success = true;

      if (message) {
        const response = messageFromMods + modCommon.warnMessage(u.escapeText(interaction.member?.displayName ?? interaction.user.displayName)) + `\n\n**Reason:** ${reason}`;
        await target.send({ content: response, embeds: [u.msgReplicaEmbed(message)] }).catch(() => blocked(target));
      } else {
        await target.send(messageFromMods + `**${interaction.member.displayName}** has issued the following warning regarding your behavior or content you have posted:\n\n>>> ${reason}`);
      }

      const sum = await u.db.infraction.getSummary(target.id);
      embed.addFields({ name: `Infraction Summary (${sum.time} Days) `, value: `Infractions: ${sum.count}\nPoints: ${sum.points}` });

      flag?.edit({ embeds: [embed] });
      return `${target} has been warned **${value}** points for reason \`${reason}\``;
    } catch (error) {
      await u.errorHandler(error, interaction);
      return "I ran into an error! " + (success ? "I *was* able to save the warning though." : "I wasn't able to save the warning.");
    }
  },
  /** @param {string} mod */
  warnMessage: function(mod) {
    return "We have received one or more complaints regarding content you posted.\n"
    + `We have reviewed the content in question and have determined, in our sole discretion, that it is against our ${code}.\n`
    + "This content was removed on your behalf. As a reminder, if we believe that you are frequently in breach of our Code of Conduct or are otherwise acting inconsistently with the letter or spirit of the code, we may limit, suspend or terminate your access to the LDSG Discord server.\n\n"
    + `**${mod}** has issued this warning.`;
  },
  /** @type {Set<string>} */
  watchlist: new Set(),
  /** @type {Discord.Collection<string, any>} */
  grownups: new u.Collection()
};

module.exports = modCommon;
