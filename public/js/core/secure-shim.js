// 局域网 HTTP 访问（非安全上下文）兼容补丁。
// 浏览器只在 HTTPS 或 localhost 下提供 crypto.randomUUID 等接口；用局域网 IP 打开时
// 这些接口不存在，会导致控制台/歌词台脚本直接抛异常（表现为页面能开、但操作没反应）。
// 这里在页面其他脚本之前补上等价实现。
(function secureContextShim() {
  const cryptoObj = window.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID !== 'function') {
    const randomUUID = function randomUUID() {
      const bytes = new Uint8Array(16);
      if (typeof cryptoObj.getRandomValues === 'function') {
        cryptoObj.getRandomValues(bytes);
      } else {
        for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
      }
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };
    try {
      Object.defineProperty(cryptoObj, 'randomUUID', { value: randomUUID, configurable: true, writable: true });
    } catch {
      cryptoObj.randomUUID = randomUUID;
    }
  }
}());
