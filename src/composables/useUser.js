import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { apiUrl } from '../config/apiBase.js';

const user = ref(null);
const isAuthReady = ref(false);
let authInitPromise = null;

// 辅助函数：获取 Token
const getToken = () => {
    try {
        return localStorage.getItem('token');
    } catch {
        return null;
    }
};

// 辅助函数：带 Token 的 Fetch 请求 (核心工具!)
export async function authFetch(url, options = {}) {
    const token = getToken();
    const headers = { ...(options.headers || {}) };
    const isFormData =
        typeof FormData !== 'undefined' &&
        options.body &&
        options.body instanceof FormData;
    if (!isFormData && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const resolvedUrl = apiUrl(url);
    const res = await fetch(resolvedUrl, { ...options, headers });

    // 如果 Token 过期或无效 (401)，自动登出
    // 403 可能是权限/拉黑等业务拒绝，不应直接清除登录态
    if (res.status === 401) {
        localStorage.removeItem('token');
        user.value = null;
        // 可选: window.location.href = '/login';
    }
    return res;
}

const checkAuth = async () => {
    const token = getToken();
    if (!token) {
        isAuthReady.value = true;
        return;
    }
    try {
        const res = await authFetch('/api/auth/me');
        if (res.ok) {
            user.value = await res.json();
        } else {
            user.value = null;
            localStorage.removeItem('token');
        }
    } catch (e) {
        console.error("Auth check failed", e);
    } finally {
        isAuthReady.value = true;
    }
};

export const ensureAuthReady = () => {
    if (isAuthReady.value) return authInitPromise || Promise.resolve();
    if (!authInitPromise) authInitPromise = checkAuth();
    return authInitPromise;
};

// 供 Router / Navbar 等在组件外使用（避免重复请求）
export const authUser = user;
export const authReady = isAuthReady;

// 尽早恢复登录状态，减少刷新时的闪屏/误跳转
try {
    if (typeof window !== 'undefined') ensureAuthReady();
} catch { }

export function useUser() {
    const router = useRouter();
    const error = ref(null);
    const isLoading = ref(false);
    const successMessage = ref('');

    ensureAuthReady();

    const handleAuthResponse = async (url, payload) => {
        isLoading.value = true;
        error.value = null;
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || '操作失败');

            // ✅ 保存 Token
            localStorage.setItem('token', data.token);
            // ✅ 兼容 music/request.js 的 token 读取（JSON.parse(...).token）
            try {
                localStorage.setItem('museai_token', JSON.stringify({ token: data.token }));
            } catch { }
            user.value = data.user;
            router.push('/studio');
        } catch (err) {
            error.value = err.message;
        } finally {
            isLoading.value = false;
        }
    };

    const register = (payload) => handleAuthResponse(apiUrl('/api/register'), payload);
    const login = (payload) => handleAuthResponse(apiUrl('/api/login'), payload);

    const logout = () => {
        localStorage.removeItem('token');
        user.value = null;
        router.push('/');
    };

    const updateProfile = async (updates) => {
        isLoading.value = true;
        error.value = null;
        successMessage.value = '';
        try {
            const res = await authFetch('/api/users/me', {
                method: 'PUT',
                body: JSON.stringify(updates)
            });
            if (!res.ok) throw new Error('更新失败');

            user.value = await res.json(); // 更新本地状态
            successMessage.value = "个人信息已保存";
        } catch (err) {
            error.value = err.message;
        } finally {
            isLoading.value = false;
        }
    };

    return {
        user,
        isAuthReady,
        error,
        successMessage,
        isLoading,
        register,
        login,
        logout,
        updateProfile,
        authFetch // 导出给组件使用
    };
}
