import React from 'react';
import {Pressable,Text,View} from 'react-native';
export function UnavailableMessage({state,onRetry}:{state:'retryable'|'unavailable'|'blocked';onRetry:()=>void}) {
 return <View accessible accessibilityLabel={state==='retryable'?"Can't open this message":'Message unavailable on this device'}>
  <Text>{state==='retryable'?"Can't open this message":state==='unavailable'?'Message unavailable on this device':'This message could not be verified'}</Text>
  {state==='retryable'&&<Pressable accessibilityRole="button" onPress={onRetry}><Text>Try again</Text></Pressable>}
 </View>;
}
