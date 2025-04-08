export function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function convertBytes(bytes: number, decimals = 2) {
  if (bytes === 0) {
    return {
      value: 0,
      unit: 'Bytes',
      formatted: '0 Bytes'
    };
  }

  const k = 1024;
  const units = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  const formattedValue = parseFloat(value.toFixed(decimals));

  return {
    value: formattedValue,
    unit: units[i],
    formatted: `${formattedValue}${units[i]}`,
    rawBytes: bytes
  };
}
