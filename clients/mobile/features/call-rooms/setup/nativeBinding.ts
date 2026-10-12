import { secureCoreModule } from "../../../modules/linqa-secure-core";
import { linqaCoreBinding } from "./linqaCoreAdapter";
export function nativeCallBinding() {
  const native=secureCoreModule();
  if(!native || typeof native.sealCallKey !== 'function' || typeof native.openCallKey !== 'function' || typeof native.signCallMessage !== 'function') throw new Error('Rebuild the Linqa dev client to enable secure calls.');
  return linqaCoreBinding({
    sealToDevice: args=>native.sealCallKey(args.x25519,args.mlkem768,args.plaintext,args.aad),
    openSealed: args=>native.openCallKey(args.sealed,args.aad),
    signWithIdentity: args=>native.signCallMessage(args.message)
  });
}
