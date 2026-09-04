import toast from 'react-hot-toast';

/**
 * 复制文本到剪贴板。
 *
 * navigator.clipboard 只在安全上下文（HTTPS 或 localhost）下存在，面板通常通过
 * http://IP:端口 访问，此时该 API 为 undefined，直接调用会抛异常导致复制永远失败。
 * 因此这里回退到 document.execCommand('copy')，它在非安全上下文下仍可用。
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 继续尝试下面的兜底方案
    }
  }

  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  // 必须留在可聚焦的文档流内，否则 iOS Safari 不会执行复制
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  textarea.style.padding = '0';
  textarea.style.border = 'none';
  textarea.style.outline = 'none';
  textarea.style.boxShadow = 'none';
  textarea.style.background = 'transparent';
  textarea.style.opacity = '0';

  document.body.appendChild(textarea);
  const selection = document.getSelection();
  const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
    if (previousRange && selection) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }
  }
}

/**
 * 复制并给出成功/失败提示，失败时提示用户手动复制。
 */
export async function copyWithToast(text: string, label = '内容'): Promise<boolean> {
  const ok = await copyText(text);
  if (ok) {
    toast.success(`已复制${label}`);
  } else {
    toast.error('复制失败，请手动选择文本复制');
  }
  return ok;
}
