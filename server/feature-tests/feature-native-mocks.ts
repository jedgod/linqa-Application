import {randomBytes} from 'node:crypto';
export const files=new Map<string,Buffer>();
export const cacheDirectory='file:///cache/';
export const EncodingType={Base64:'base64'};
export async function getInfoAsync(path:string){const data=files.get(path);return data?{exists:true,size:data.length,isDirectory:false}:{exists:false};}
export async function readAsStringAsync(path:string){const data=files.get(path);if(!data)throw Error('missing file');return data.toString('base64');}
export async function writeAsStringAsync(path:string,data:string){files.set(path,Buffer.from(data,'base64'));}
export async function deleteAsync(path:string){for(const key of files.keys())if(key===path||key.startsWith(path.endsWith('/')?path:path+'/'))files.delete(key);}
export async function makeDirectoryAsync(){}
export async function getRandomBytesAsync(size:number){return new Uint8Array(randomBytes(size));}
export async function requestPermissionsAsync(){return {granted:false};}
export async function isAvailableAsync(){return false;}
export async function shareAsync(){throw Error('sharing unavailable');}
export async function saveToLibraryAsync(){throw Error('library permission denied');}
