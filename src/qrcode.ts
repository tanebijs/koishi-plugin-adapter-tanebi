import { DataService } from '@koishijs/plugin-console';
import { Context } from 'koishi';

declare module '@koishijs/plugin-console' {
    namespace Console {
        interface Services {
            'tanebi.qrcode': QrCodeProvider;
        }
    }
}

export class QrCodeProvider extends DataService<string | undefined> {
    constructor(ctx: Context, private readonly getQrCode: () => Buffer | undefined) {
        super(ctx, 'tanebi.qrcode');
    }

    override async get(): Promise<string | undefined> {
        const qrCode = this.getQrCode();
        return qrCode ? `data:image/png;base64,${qrCode.toString('base64')}` : undefined;
    }
}
