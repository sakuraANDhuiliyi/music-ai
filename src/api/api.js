import { apiUrl } from '../config/apiBase.js';

const API_BASE_URL = apiUrl('/api'); // 走 Vite proxy 或同域部署

// 通用的请求处理函数
async function request(endpoint, options = {}) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        },
        ...options
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || '请求失败');
    }
    return data;
}
export const apiRegister = async ({ email, password, username }) => {
    const user = await request('/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, username })
    });
    localStorage.setItem('museai_token', JSON.stringify(user));
    return user;
};

export const apiLogin = async ({ email, password }) => {
    const user = await request('/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
    });
    localStorage.setItem('museai_token', JSON.stringify(user));
    return user;
};

export const apiLogout = async () => {
    localStorage.removeItem('museai_token');
};

export const apiCheckAuth = async () => {
    const user = localStorage.getItem('museai_token');
    return user ? JSON.parse(user) : null;
};

export const apiUpdateProfile = async (uid, updates) => {
    const updatedUser = await request(`/users/${uid}`, {
        method: 'PUT',
        body: JSON.stringify(updates)
    });
    localStorage.setItem('museai_token', JSON.stringify(updatedUser));
    return updatedUser;
};
