// src/composables/useLoader.js
import { ref } from 'vue';

// 定义在函数外部，形成全局单例状态
const isLoading = ref(false);

export function useLoader() {
    const showLoading = () => {
        isLoading.value = true;
    };

    const hideLoading = () => {
        isLoading.value = false;
    };

    return {
        isLoading,
        showLoading,
        hideLoading
    };
}