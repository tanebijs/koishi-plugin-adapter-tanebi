import { Context, store } from '@koishijs/client';
import QrCodeDisplay from './qrcode.vue';
import {} from '../src/qrcode';

export default (ctx: Context) => {
    ctx.slot({
        type: 'plugin-details',
        component: QrCodeDisplay,
        order: 100,
        disabled: () => !store['tanebi.qrcode'],
    });
};
