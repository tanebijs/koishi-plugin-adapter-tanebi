import { Schema, Bot as KoishiBot, Context } from 'koishi';
import { fetchAppInfoFromSignUrl, UrlSignProvider, DeviceInfo, newDeviceInfo, deserializeDeviceInfo, Keystore, newKeystore, deserializeKeystore, serializeDeviceInfo, ctx, serializeKeystore, Bot } from 'tanebi';
import { resolve } from 'node:path';
import { QrCodeProvider } from './qrcode';
import { Channel, Guild, GuildMember, List, User } from '@satorijs/protocol';
import { toKoishiChannel, toKoishiGuild, toKoishiGuildMember, toKoishiUser } from './transform/entity';

declare module 'koishi' {
    interface Tables {
        'tanebi.deviceInfo': {
            uin: number;
            payload: string;
        };
        'tanebi.keystore': {
            uin: number;
            payload: string;
        };
    }
}

class TanebiBot extends KoishiBot<Context, TanebiBot.Config> {
    internal: Bot;
    qrCode?: Buffer;

    constructor(ctx: Context, config: TanebiBot.Config) {
        super(ctx, config);
        this.platform = 'tanebi';
        this.logger = ctx.logger('tanebi');

        this.ctx.inject(['console'], (ctx) => {
            ctx.console.addEntry({
                dev: resolve(__dirname, '../client/index.ts'),
                prod: resolve(__dirname, '../dist'),
            });
        });

        this.ctx.plugin(QrCodeProvider, () => this.qrCode);

        this.ctx.model.extend('tanebi.deviceInfo', {
            uin: 'integer',
            payload: 'string',
        }, {
            primary: 'uin',
        });

        this.ctx.model.extend('tanebi.keystore', {
            uin: 'integer',
            payload: 'string',
        }, {
            primary: 'uin',
        });
    }

    override async start(): Promise<void> {
        let firstUse = false;

        const appInfo = await fetchAppInfoFromSignUrl(this.config.signApiUrl);
        const signProvider = UrlSignProvider(this.config.signApiUrl);

        let deviceInfo: DeviceInfo;
        const deviceInfoQuery = await this.ctx.database.get('tanebi.deviceInfo', { uin: this.config.uin });
        if (deviceInfoQuery.length === 0) {
            firstUse = true;
            deviceInfo = newDeviceInfo();
        } else {
            deviceInfo = deserializeDeviceInfo(JSON.parse(deviceInfoQuery[0].payload));
        }

        let keystore: Keystore;
        const keystoreQuery = await this.ctx.database.get('tanebi.keystore', { uin: this.config.uin });
        if (keystoreQuery.length === 0) {
            firstUse = true;
            keystore = newKeystore();
        } else {
            keystore = deserializeKeystore(JSON.parse(keystoreQuery[0].payload));
        }

        this.internal = await Bot.create(appInfo, {}, deviceInfo, keystore, signProvider);

        this.internal.onDebug((module, message) => this.logger.debug(`[${module}] ${message}`));
        this.internal.onInfo((module, message) => this.logger.info(`[${module}] ${message}`));
        this.internal.onWarning((module, message) => this.logger.warn(`[${module}] ${message}`));

        if (firstUse) {
            try {
                await this.internal.qrCodeLogin((url, png) => {
                    this.logger.info('Please scan the QR code on the screen with Mobile QQ.');
                    this.logger.info('Or you can manually generate a QR code with the following URL:');
                    this.logger.info(url);
                    this.qrCode = png;
                    this.ctx.console.refresh('tanebi.qrcode');
                });
                await this.ctx.database.create('tanebi.deviceInfo', {
                    uin: this.config.uin,
                    payload: JSON.stringify(serializeDeviceInfo(this.internal[ctx].deviceInfo)),
                });
                await this.ctx.database.create('tanebi.keystore', {
                    uin: this.config.uin,
                    payload: JSON.stringify(serializeKeystore(this.internal[ctx].keystore)),
                });
            } finally {
                delete this.qrCode;
                this.ctx.console.refresh('tanebi.qrcode');
            }
        } else {
            await this.internal.fastLogin();
        }
    }

    override async getGuildList(): Promise<List<Guild>> {
        const groups = Array.from(await this.internal.getGroups());
        return {
            data: groups.map(toKoishiGuild),
        };
    }

    override async getGuild(guildId: string): Promise<Guild> {
        const group = await this.internal.getGroup(parseInt(guildId));
        return toKoishiGuild(group);
    }

    override async getChannelList(guildId: string): Promise<List<Channel>> {
        const group = await this.internal.getGroup(parseInt(guildId));
        return {
            data: [toKoishiChannel(group)],
        };
    }

    override async getChannel(channelId: string, guildId?: string): Promise<Channel> {
        const group = await this.internal.getGroup(parseInt(guildId ?? channelId));
        return toKoishiChannel(group);
    }

    override async getFriendList(): Promise<List<User>> {
        const friends = Array.from(await this.internal.getFriends());
        return {
            data: friends.map(toKoishiUser),
        };
    }

    override async getGuildMemberList(guildId: string): Promise<List<GuildMember>> {
        const group = await this.internal.getGroup(parseInt(guildId));
        const members = Array.from(await group.getMembers());
        return {
            data: members.map(toKoishiGuildMember),
        };
    }

    override async getGuildMember(guildId: string, userId: string): Promise<GuildMember> {
        const group = await this.internal.getGroup(parseInt(guildId));
        const member = await group.getMember(parseInt(userId));
        return toKoishiGuildMember(member);
    }

    override async kickGuildMember(guildId: string, userId: string, permanent?: boolean): Promise<void> {
        const group = await this.internal.getGroup(parseInt(guildId));
        const member = await group.getMember(parseInt(userId));
        await member.kick(!permanent);
    }

    override async muteGuildMember(guildId: string, userId: string, duration: number): Promise<void> {
        const group = await this.internal.getGroup(parseInt(guildId));
        const member = await group.getMember(parseInt(userId));
        await member.mute(Math.round(duration / 1000));
    }

    override async dispose(): Promise<void> {
        await this.internal.dispose();
    }
}

namespace TanebiBot {
    export const inject = ['database', 'logger', 'console'];

    export interface Config {
        uin: number;
        signApiUrl: string;
    }

    export const Config: Schema<Config> = Schema.object({
        uin: Schema.number()
            .description('机器人 QQ 号')
            .default(0),
        signApiUrl: Schema.string()
            .description('签名 API URL')
            .default('https://sign.lagrangecore.org/api/sign/30366'),
    });
}

export default TanebiBot;
