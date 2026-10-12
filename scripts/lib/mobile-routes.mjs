export const phoneSerials = new Set(['LMX320969df2b0', 'R9TT703HH0Y']);
export function connectedPhones(output) {
  return output.split(/\r?\n/).flatMap(line => {
    const match = /^(\S+)\s+device(?:\s|$)/.exec(line);
    if (!match) return [];
    const serial = match[1];
    // Wi-Fi ADB transports have an address instead of the USB serial.
    return phoneSerials.has(serial) || /\bmodel:(LM_X320|SM_A037U)\b/.test(line) ? [serial] : [];
  });
}
export function routeMappings(apiPort, metroPort) {
  return [[8080,apiPort],[8088,apiPort],[8081,metroPort],[8082,metroPort],[8083,metroPort]];
}
export function missingRoutes(output, mappings) {
  const active = new Set(output.split(/\r?\n/).flatMap(line => {
    const match = /\s(tcp:\d+)\s(tcp:\d+)\s*$/.exec(line);
    return match ? [`${match[1]} ${match[2]}`] : [];
  }));
  return mappings.filter(([local,remote]) => !active.has(`tcp:${local} tcp:${remote}`));
}
