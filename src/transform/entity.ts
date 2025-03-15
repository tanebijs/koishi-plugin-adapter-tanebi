import { Channel, Guild, GuildMember, User } from '@satorijs/protocol';
import { BotFriend, BotGroup, BotGroupMember, GroupMemberPermission } from 'tanebi';

export function toKoishiUser(friend: BotFriend): User {
    return {
        id: '' + friend.uin,
        name: friend.nickname,
        avatar: `https://q.qlogo.cn/headimg_dl?dst_uin=${friend.uin}&spec=640&img_type=jpg`,
    };
}

export function toKoishiChannel(group: BotGroup): Channel {
    return {
        id: '' + group.uin,
        name: group.name,
        type: Channel.Type.TEXT,
    };
}

export function toKoishiGuild(group: BotGroup): Guild {
    return {
        id: '' + group.uin,
        name: group.name,
    };
}

export function toKoishiGuildMember(member: BotGroupMember): GuildMember {
    const avatar = `https://q.qlogo.cn/headimg_dl?dst_uin=${member.uin}&spec=640&img_type=jpg`;
    return {
        user: {
            id: '' + member.uin,
            name: member.nickname,
            avatar,
        },
        name: member.card,
        nick: member.nickname,
        avatar,
        title: member.specialTitle,
        roles: member.permission === GroupMemberPermission.Owner ? ['owner', 'admin'] : member.permission === GroupMemberPermission.Admin ? ['admin'] : [],
    };
}
