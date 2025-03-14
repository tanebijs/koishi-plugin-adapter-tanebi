import { Schema, Bot as KoishiBot, Context } from 'koishi';
import { fetchAppInfoFromSignUrl, UrlSignProvider, DeviceInfo, newDeviceInfo, deserializeDeviceInfo, Keystore, newKeystore, deserializeKeystore, serializeDeviceInfo, ctx, serializeKeystore, Bot } from 'tanebi';
import { resolve } from 'node:path';
import { QrCodeProvider } from './qrcode';

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
            await this.internal.qrCodeLogin((url, png) => {
                this.logger.info('Please scan the QR code on the screen with Mobile QQ.');
                this.logger.info('Or you can manually generate a QR code with the following URL:');
                this.logger.info(url);
                this.qrCode = png;
                this.ctx.console.refresh('tanebi.qrcode');
            });
            delete this.qrCode;
            this.ctx.console.refresh('tanebi.qrcode');
            await this.ctx.database.create('tanebi.deviceInfo', {
                uin: this.config.uin,
                payload: JSON.stringify(serializeDeviceInfo(this.internal[ctx].deviceInfo)),
            });
            await this.ctx.database.create('tanebi.keystore', {
                uin: this.config.uin,
                payload: JSON.stringify(serializeKeystore(this.internal[ctx].keystore)),
            });
        } else {
            await this.internal.fastLogin();
        }
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
