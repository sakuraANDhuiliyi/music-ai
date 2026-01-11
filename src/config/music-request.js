import axios from "axios";
import { APP_CONFIG } from "./appConfig.js";
// import { h } from "vue";
// import { ElNotification } from "element-plus";

// 创建一个 axios 实例
const http = axios.create({
  timeout: APP_CONFIG.requestTimeoutMs, // 请求超时时间毫秒
  withCredentials: true, // 异步请求携带cookie
  headers: {
    // 设置后端需要的传参类型
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
  },
});

// 添加请求拦截器
http.interceptors.request.use(
  function (config) {
    // 移除原有的 User Store 依赖，因为网易云代理不需要本地用户的 Token
    // 在发送请求之前做些什么
    return config;
  },
  function (error) {
    // 对请求错误做些什么
    console.log(error);
    return Promise.reject(error);
  }
);

// 添加响应拦截器
http.interceptors.response.use(
  function (response) {
    const dataAxios = response.data;
    // 这里简单返回 data，原项目可能有更多错误处理逻辑，为了稳定性暂时保留核心返回
    return dataAxios;
  },
  function (error) {
    // 对响应错误做点什么
    console.log(error);
    return Promise.reject(error);
  }
);

export default http;
