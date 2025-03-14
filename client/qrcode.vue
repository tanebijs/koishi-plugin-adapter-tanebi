<script lang="ts" setup>
import {} from '../src/qrcode.ts';
import { store } from '@koishijs/client';
import { computed } from 'vue';
</script>

<template>
    <p>请扫描如下二维码登录 Tanebi：</p>
    <img :src="store['tanebi.qrcode']"/>
</template>
