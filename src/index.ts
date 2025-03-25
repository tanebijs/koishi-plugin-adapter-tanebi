import { Schema, Bot as KoishiBot, Context } from 'koishi';
import {
    fetchAppInfoFromSignUrl,
    UrlSignProvider,
    DeviceInfo,
    newDeviceInfo,
    deserializeDeviceInfo,
    Keystore,
    newKeystore,
    deserializeKeystore,
    serializeDeviceInfo,
    ctx,
    serializeKeystore,
    Bot,
    faceCache,
} from 'tanebi';
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

        this.ctx.model.extend(
            'tanebi.deviceInfo',
            {
                uin: 'integer',
                payload: 'string',
            },
            {
                primary: 'uin',
            }
        );

        this.ctx.model.extend(
            'tanebi.keystore',
            {
                uin: 'integer',
                payload: 'string',
            },
            {
                primary: 'uin',
            }
        );
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

        if (this.config.logging.message) {
            this.installMessageLogger();
        }

        if (this.config.logging.event) {
            this.installEventLogger();
        }

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

    private installMessageLogger() {
        this.internal.onPrivateMessage((friend, message) =>
            this.logger.info(
                message.isSelf ? '->' : '<-',
                `[${friend.remark || friend.nickname} (${friend.uin})]`,
                message.content.toPreviewString()
            )
        );

        this.internal.onGroupMessage((group, sender, message) =>
            this.logger.info(
                sender.uin === this.internal.uin ? '->' : '<-',
                `[${group.name} (${group.uin})]`,
                `[${sender.card || sender.nickname} (${sender.uin})]`,
                message.content.toPreviewString()
            )
        );
    }

    private installEventLogger() {
        this.internal.onFriendPoke((friend, isSelf, actionStr, _, suffix) =>
            this.logger.info(
                '[friend-poke]',
                isSelf
                    ? `你${actionStr || '戳了戳'}${friend.remark || friend.nickname} (${friend.uin}) ${suffix}`
                    : `${friend.remark || friend.nickname} (${friend.uin}) ${actionStr || '戳了戳'}你${suffix}`
            )
        );

        this.internal.onFriendRecall((friend, _, tip) => {
            this.logger.info('[friend-recall]', `[${friend.remark || friend.nickname} (${friend.uin})]`, tip);
        });

        this.internal.onFriendRequest((req) => {
            this.logger.info('[friend-request]', `(${req.fromUin})`, 'with message', req.message, 'via', req.via);
        });

        this.internal.onGroupAdminChange((group, member, isPromote) => {
            this.logger.info(
                '[group-admin-change]',
                `[${group.name} (${group.uin})]`,
                `${member.card || member.nickname} (${member.uin})`,
                isPromote ? 'promoted' : 'demoted'
            );
        });

        this.internal.onGroupEssenceMessageChange((group, sequence, operator, isAdd) => {
            this.logger.info(
                '[group-essence-message-change]',
                `[${group.name} (${group.uin})]`,
                `[sequence=${sequence}]`,
                isAdd ? 'added to essence by' : 'removed from essence by',
                `${operator.card || operator.nickname} (${operator.uin})`,
            );
        });

        this.internal.onGroupInvitationRequest((req) => {
            this.logger.info(
                '[group-invitation-request]',
                `[${req.invitor.remark || req.invitor.nickname} (${req.invitor.uin})]`,
                'invited you to join group',
                req.groupUin,
            );
        });

        this.internal.onGroupInvitedJoinRequest((group, req) => {
            this.logger.info(
                '[group-invited-join-request]',
                `[${group.name} (${group.uin})]`,
                `${req.invitor.card || req.invitor.nickname} (${req.invitor.uin})`,
                'invited',
                `(${req.targetUin})`,
                'to join',
            );
        });

        this.internal.onGroupJoinRequest((group, req) => {
            this.logger.info(
                '[group-join-request]',
                `[${group.name} (${group.uin})]`,
                `(${req.requestUin})`,
                'applied to join with comment',
                req.comment,
            );
        });

        this.internal.onGroupMemberIncrease((group, member, operator) => {
            this.logger.info(
                '[group-member-increase]',
                `[${group.name} (${group.uin})]`,
                `${member.card || member.nickname} (${member.uin})`,
                'joined',
                `[handled by ${operator.card || operator.nickname} (${operator.uin})]`
            );
        });

        this.internal.onGroupMemberLeave((group, memberUin) => {
            this.logger.info(
                '[group-member-decrease]',
                `[${group.name} (${group.uin})]`,
                `(${memberUin})`,
                'left',
            );
        });

        this.internal.onGroupMemberKick((group, memberUin, operator) => {
            this.logger.info(
                '[group-member-kick]',
                `[${group.name} (${group.uin})]`,
                `(${memberUin})`,
                'was kicked by',
                `${operator.card || operator.nickname} (${operator.uin})`
            );
        });

        this.internal.onGroupMute((group, member, operator, duration) => {
            this.logger.info(
                '[group-mute]',
                `[${group.name} (${group.uin})]`,
                `${member.card || member.nickname} (${member.uin})`,
                'was muted by',
                `${operator.card || operator.nickname} (${operator.uin})`,
                'for',
                duration,
                'seconds'
            );
        });

        this.internal.onGroupUnmute((group, member, operator) => {
            this.logger.info(
                '[group-unmute]',
                `[${group.name} (${group.uin})]`,
                `${member.card || member.nickname} (${member.uin})`,
                'was unmuted by',
                `${operator.card || operator.nickname} (${operator.uin})`
            );
        });

        this.internal.onGroupMuteAll((group, operator, isSet) => {
            this.logger.info(
                '[group-mute-all]',
                `[${group.name} (${group.uin})]`,
                isSet ? 'was muted by' : 'was unmuted by',
                `${operator.card || operator.nickname} (${operator.uin})`
            );
        });

        this.internal.onGroupReaction((group, _, operator, code, isAdd) => {
            this.logger.info(
                '[group-reaction]',
                `[${group.name} (${group.uin})]`,
                `${operator.card || operator.nickname} (${operator.uin})`,
                isAdd ? 'added reaction' : 'removed reaction',
                this.internal[faceCache].get(code)?.qDes ?? '',
                `(${code})`
            );
        });

        this.internal.onGroupRecall((group, _, tip, operator) => {
            this.logger.info(
                '[group-recall]',
                `[${group.name} (${group.uin})]`,
                `${operator.card || operator.nickname} (${operator.uin})`,
                tip,
            );
        });

        this.internal.onGroupPoke((group, sender, receiver, actionStr, _, suffix) =>
            this.logger.info(
                '[group-poke]',
                `[${group.name} (${group.uin})]`,
                `${sender.card || sender.nickname} (${sender.uin}) ${actionStr || '戳了戳'}${
                    receiver.card || receiver.nickname
                } (${receiver.uin}) ${suffix}`
            )
        );
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
        logging: {
            message: boolean;
            event: boolean;
        };
    }

    export const Config: Schema<Config> = Schema.object({
        uin: Schema.number().description('机器人 QQ 号').default(0),
        signApiUrl: Schema.string().description('签名 API URL').default('https://sign.lagrangecore.org/api/sign/30366'),
        logging: Schema.object({
            message: Schema.boolean().description('记录消息日志').default(true),
            event: Schema.boolean().description('记录事件日志').default(true),
        }),
    });
}

export default TanebiBot;
