const { Client, Intents, MessageEmbed } = require('discord.js');
const { joinVoiceChannel, createAudioResource, playAudioResource, AudioPlayerStatus, createAudioPlayer } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const youtubeSearch = require('youtube-search');
require('dotenv').config();

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_VOICE_STATES] });

const token = process.env.DISCORD_TOKEN
const prefix = process.env.DISCORD_PREFIX
const YouTube_API_Key = process.env.YouTube_API_KEY

let queues = {};
const voiceConnections = {};

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (!message.content.startsWith(prefix) || message.author.bot) return;
    const command = message.content.slice(prefix.length).trim().split(/ +/)[0].toLowerCase();
    const guildId = message.guild.id;
    if (command === 'play') {
        const arg = message.content.slice(prefix.length + command.length + 1).trim();

        const searchOptions = {
            maxResults: 1,
            key: YouTube_API_Key,
            type: 'video'
        };
        if (arg.startsWith('https')) {
            if (arg.includes("youtube.com") || arg.includes("youtu.be")) {
                queue_List(arg,message)
                return;
            }
            message.channel.send("指定されたURLには対応していません")
        }
        else {
            youtubeSearch(arg, searchOptions, async (err, results) => {
                if (err) {
                    message.channel.send("内部エラーが発生しました")
                return;
                }
    
                if (results && results.length > 0) {
                    const url = results[0].link;
                    queue_List(url,message)
                }
                else {
                    message.channel.send("動画が見つかりませんでした")
                }
            });
        }
    }

    if (command === "queue") {
        const guildQueue = queues[guildId];
        if (!guildQueue || guildQueue.length === 0) {
            const queueEmbed = new MessageEmbed()
                .setTitle('キュー')
                .setDescription('現在キューに曲はありません')
                .setColor('RED');
            message.channel.send({ embeds: [queueEmbed] });
        } else {
            const queueEmbed = new MessageEmbed()
                .setTitle('キュー')
                .setDescription('現在のキューには以下の曲が入っています')
                .setColor('RED');
                
            let position = 1;
            for (let i = 0; i < guildQueue.length; i++) {
                const url = guildQueue[i];
                const info = await ytdl.getInfo(url);
                const title = info.videoDetails.title;
                queueEmbed.addFields({ name: `No.${position}`, value: `**${title}**` });
                position++;
            }
            
            message.channel.send({ embeds: [queueEmbed] });
        }
    }

    if (command === "stop") {
        const voiceGuildIds = Object.keys(voiceConnections);
        for (const voiceGuildId of voiceGuildIds) {
        if (voiceGuildId === guildId) {
            try {
            voiceConnections[guildId].disconnect();
            delete voiceConnections[guildId];
            delete queues[guildId];
            message.channel.send("再生を停止しました");
            }
            catch(err) {
            message.channel.send("現在再生中の曲はありません");
            }
        }
        }
    }

    if (command === "skip") {
        if (queue.length > 0) {
            play(message)
        }
        else {
            message.channel.send("キューに曲が追加されていません");
        }
    }

    if (command === "help") {
        const helpEmbed = new MessageEmbed()
            .setTitle('使い方')
            .setDescription('プレフィックスは「!」です')
            .addFields(
                { name: "コマンド", value: "説明" },
                { name: "!play", value: "音楽を再生するためのコマンドです" },
                { name: "!queue", value: "現在の再生待機リストを確認できます" },
                { name: "!stop", value: "現在再生中の曲を停止してVCから切断します(キューもクリアされます)" },
                { name: "!skip", value: "キューが入っていた場合次の曲を再生します" }
            )
            .setColor('RED');
        message.channel.send({ embeds: [helpEmbed] });
    }
});

async function queue_List(url, message) {
    const guildId = message.guild.id;
    const queue = queues[guildId] || [];
    queues[guildId] = queue;
    if (!isPlaying(guildId)) {
        queue.push(url);
        play(message);
    } else {
        queue.push(url);
        message.channel.send('キューに追加されました');
    }
}

function isPlaying(guildId) {
    const queue = queues[guildId];
    return queue && queue.length > 0;
}

async function play(message) {
    const guildId = message.guild.id;
    const queue = queues[guildId];
    if (!queue || queue.length === 0) {
        voiceConnections[guildId].disconnect();
        delete voiceConnections[guildId];
        delete queues[guildId];
        return;
    }
    try {
        voiceConnections[guildId] = joinVoiceChannel({
            channelId: message.member.voice.channel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator
        });          
    } catch (error) {
        message.channel.send('VCに参加してからコマンドを実行してください');
    }
    const queue_Now = queue.shift()
    queue.unshift(queue_Now);
    const player = createAudioPlayer();
    voiceConnections[guildId].subscribe(player);
    const stream = ytdl(ytdl.getURLVideoID(queue_Now), {
        filter: format => format.audioCodec === 'opus' && format.container === 'webm',
        quality: 'highest',
        highWaterMark: 64 * 1024 * 1024,
    });
    const resource = createAudioResource(stream, {
        inputType: "webm/opus"
    });
    player.play(resource);
    player.once('stateChange', async (oldState, newState) => {
        if (newState.status === AudioPlayerStatus.Playing) {
            try {
                const info = await ytdl.getInfo(queue_Now);
                const title = info.videoDetails.title;
                const duration = info.videoDetails.lengthSeconds;
                const embed = new MessageEmbed()
                    .setTitle(`:musical_note: **Playing Now : ${title}**`)
                    .setDescription(`:alarm_clock: **Duration : ${formatDuration(duration)}**`)
                    .setColor('RED');
                message.channel.send({ embeds: [embed] });
            } catch (error) {
                message.channel.send('動画データの取得に失敗しました')
            }
        }
    });
    player.on('stateChange', (oldState, newState) => {
        if (newState.status === AudioPlayerStatus.Idle) {
            queue.shift()
            if (queue.length > 0) {
                play(message);
            } else {
                setTimeout(() => {
                    voiceConnections[guildId].disconnect();
                    delete voiceConnections[guildId];
                    delete queues[guildId];
                }, 1000);
            }
        }
    });
    const handleVoiceStateUpdate = (oldState, newState) => {
        if (oldState.member.id === client.user.id && oldState.channel && !newState.channel) {
            if (voiceConnections[guildId]) {
                voiceConnections[guildId].disconnect();
                delete voiceConnections[guildId];
                delete queues[guildId];
                client.off('voiceStateUpdate', handleVoiceStateUpdate);
            }
        }
    };
    client.on('voiceStateUpdate', handleVoiceStateUpdate);
}

function formatDuration(duration) {
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

client.login(token);
