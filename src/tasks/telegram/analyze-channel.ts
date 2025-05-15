import readline from "node:readline";
import { TelegramClient } from "telegram";
import { LogLevel } from "telegram/extensions/Logger";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram/tl";
import {
    formatDecimal,
    formatInteger,
    formatMilliseconds,
    formatPercent,
    formatText,
} from "../../helpers/format";
import { envVars, timeSeed } from "../../modules";

const PERIOD_SECS = 1_209_600; // 1 month

function prompt(question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

(async () => {
    let client: TelegramClient | undefined;

    try {
        client = new TelegramClient(
            new StringSession(envVars.TELEGRAM_STRING_SESSION),
            envVars.TELEGRAM_API_ID,
            envVars.TELEGRAM_API_HASH,
            {
                autoReconnect: true,
                connectionRetries: 5,
            }
        );
        client.setLogLevel(LogLevel.ERROR);

        await client.start({
            phoneNumber: async () => await prompt("Enter your phone number: "),
            password: async () => await prompt("Enter your 2FA password (if any): "),
            phoneCode: async () => await prompt("Enter code you received: "),
            onError: (error: unknown) => {
                throw error;
            },
        });

        if (!envVars.TELEGRAM_STRING_SESSION) {
            console.warn(`Save this session string for future logins: ${client.session.save()}`);
        }

        const channelName = await prompt("Enter channel name: ");
        const channelEntity = await client.getInputEntity(channelName);
        const fullChannel = await client.invoke(
            new Api.channels.GetFullChannel({ channel: channelEntity })
        );

        const participantsCount =
            "participantsCount" in fullChannel.fullChat
                ? fullChannel.fullChat.participantsCount
                : 0;
        if (participantsCount === undefined) {
            throw new Error("Participant count not defined");
        }

        const firstChat = fullChannel.chats[0];
        const title = firstChat instanceof Api.Channel ? firstChat.title : "Unknown channel";
        const startTime = Date.now() - PERIOD_SECS * 1_000;

        let totalViews = 0;
        let totalMessages = 0;
        let postsInPeriod = 0;
        let lastMessageId: number | undefined;

        while (true) {
            const messages = await client.getMessages(channelEntity, {
                limit: 20,
                maxId: lastMessageId,
            });
            if (!messages.length) {
                break;
            }

            let shouldBreak = false;
            for (const message of messages) {
                if (!message.date) {
                    continue;
                }

                const messageDate = new Date(message.date * 1000).getTime();
                if (messageDate < startTime) {
                    shouldBreak = true;
                    break;
                }

                if ("views" in message && message.views !== undefined) {
                    totalViews += message.views;
                    totalMessages++;
                }

                postsInPeriod++;
                lastMessageId = message.id;
            }
            if (shouldBreak) {
                break;
            }

            const delay = timeSeed.generateRandomInteger([4_000, 8_000]);
            console.info("Waiting for %s sec before next request", formatMilliseconds(delay));
            await new Promise((resolve) => setTimeout(resolve, delay));
        }

        const averageViews = totalMessages > 0 ? totalViews / totalMessages : 0;
        const engagementRate = participantsCount > 0 ? averageViews / participantsCount : 0;

        const periodDays = PERIOD_SECS / (24 * 60 * 60);
        const averageDailyPosts = periodDays > 0 ? postsInPeriod / periodDays : 0;

        console.info(
            "Channel stats: %s\nSubscribers: %s\nAverage views: %s\nEngagement rate: %s\nTotal posts: %s\nAverage daily posts: %s",
            formatText(title),
            formatInteger(participantsCount),
            formatInteger(Math.round(averageViews)),
            formatPercent(engagementRate),
            formatInteger(postsInPeriod),
            formatDecimal(averageDailyPosts, 2)
        );

        await client.disconnect();
        process.exit(0);
    } catch (error: unknown) {
        console.error(
            `Failed to fetch channel data. Error: ${error instanceof Error ? error.message : String(error)}`
        );

        if (client) {
            await client.disconnect();
        }
        process.exit(1);
    }
})();
