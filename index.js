const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const express = require('express');
const { transcribeAudio } = require('./speechRecognition');
const settings = require('./settings.json');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages]
});

const violations = new Map();
const bannedWords = new Set(settings.bannedWords);
const MAX_VIOLATIONS = settings.maxViolations || 3;

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/status', (req, res) => {
    res.json({
        status: 'Bot is running',
        guilds: client.guilds.cache.size,
        uptime: process.uptime()
    });
});

app.listen(PORT, () => console.log(`Status server running on port ${PORT}`));

client.on('ready', () => console.log(`Logged in as ${client.user.tag}`));

client.on('messageCreate', async (message) => {
    if (!message.guild || message.author.bot) return;

    const [command, ...args] = message.content.trim().split(/\s+/);
    switch (command) {
        case '!join':
            if (message.member.voice.channel) {
                const connection = await message.member.voice.channel.join();
                listenToSpeech(connection, message.guild.id);
                message.reply('Joined voice channel!');
            } else {
                message.reply('You need to be in a voice channel first!');
            }
            break;
        case '!leave':
            if (message.guild.me.voice.channel) {
                message.guild.me.voice.channel.leave();
                message.reply('Left the voice channel.');
            }
            break;
        case '!help':
            message.reply('Commands: !join, !leave, !help');
            break;
    }
});

async function listenToSpeech(connection, guildId) {
    const receiver = connection.receiver;
    receiver.speaking.on('start', (userId) => {
        const audioStream = receiver.subscribe(userId, { end: 'silence' });
        transcribeAudio(audioStream).then((transcription) => {
            if (transcription && checkForBannedWords(transcription, userId, guildId)) {
                console.log(`User ${userId} said something inappropriate.`);
            }
        }).catch(console.error);
    });
}

function checkForBannedWords(text, userId, guildId) {
    if ([...bannedWords].some(word => text.includes(word))) {
        const userViolations = violations.get(userId) || 0;
        violations.set(userId, userViolations + 1);
        if (userViolations + 1 >= MAX_VIOLATIONS) {
            kickUser(userId, guildId);
            return true;
        }
    }
    return false;
}

async function kickUser(userId, guildId) {
    try {
        const guild = client.guilds.cache.get(guildId);
        const member = await guild.members.fetch(userId);
        if (member) {
            await member.kick('Exceeded violation limit');
            console.log(`Kicked user ${userId} for exceeding violations.`);
        }
    } catch (error) {
        console.error(`Error kicking user ${userId}:`, error);
    }
}

client.login(process.env.DISCORD_TOKEN);
