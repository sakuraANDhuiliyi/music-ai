import { ElMessage, ElMessageBox } from 'element-plus';

const fallbackNotify = (message) => {
  try {
    window.alert(message);
  } catch {
    // ignore
  }
};

export const notifyError = (message) => {
  const msg = String(message || '操作失败');
  try {
    if (ElMessage?.error) {
      ElMessage.error({ message: msg, duration: 2200, showClose: true });
      return;
    }
  } catch {
    // ignore
  }
  fallbackNotify(msg);
};

export const confirmRetry = async (message, retryFn) => {
  if (typeof retryFn !== 'function') return null;
  const msg = String(message || '加载失败，是否重试？');
  try {
    if (ElMessageBox?.confirm) {
      await ElMessageBox.confirm(msg, '提示', {
        type: 'warning',
        confirmButtonText: '重试',
        cancelButtonText: '取消',
      });
      return await retryFn();
    }
  } catch {
    return null;
  }
  try {
    if (window.confirm(msg)) return await retryFn();
  } catch {
    // ignore
  }
  return null;
};
